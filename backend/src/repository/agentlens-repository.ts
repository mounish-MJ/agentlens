import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  Run,
  RunStatus,
  Incident,
  IncidentStatus,
  IncidentRcaResult,
  RegressionTest,
  Evaluation,
  ReplayRecord,
  TelemetryEvent,
  ExecutionMetrics,
} from '../types/contracts.js';

export interface IAgentLensRepository {
  createRun(run: Run): Promise<Run>;
  getRun(run_id: string): Promise<Run | null>;
  listRuns(limit?: number): Promise<Run[]>;
  recordTelemetryEvents(run_id: string, events: TelemetryEvent[]): Promise<TelemetryEvent[]>;
  getTelemetryEvents(run_id: string, limit?: number): Promise<TelemetryEvent[]>;
  updateRunTelemetry(
    run_id: string,
    updates: {
      status?: RunStatus;
      result?: string;
      error?: string;
      metrics?: Partial<ExecutionMetrics>;
      new_events_count?: number;
      updated_at: string;
    }
  ): Promise<Run | null>;
  createIncident(incident: Incident): Promise<Incident>;
  getIncident(incident_id: string): Promise<Incident | null>;
  listIncidents(limit?: number): Promise<Incident[]>;
  listIncidentsByRun(run_id: string, limit?: number): Promise<Incident[]>;
  updateIncidentRca(
    incident_id: string,
    updates: {
      rca: IncidentRcaResult;
      status?: IncidentStatus;
      updated_at: string;
    }
  ): Promise<Incident | null>;
  createRegressionTest(test: RegressionTest): Promise<RegressionTest>;
  getRegressionTest(test_id: string): Promise<RegressionTest | null>;
  createEvaluation(evaluation: Evaluation): Promise<Evaluation>;
  getEvaluation(evaluation_id: string): Promise<Evaluation | null>;
  createReplayRecord(record: ReplayRecord): Promise<ReplayRecord>;
  getReplayRecord(replay_id: string): Promise<ReplayRecord | null>;
}

export class AgentLensRepository implements IAgentLensRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(docClient?: DynamoDBDocumentClient, tableName?: string) {
    this.tableName = tableName || process.env.DYNAMODB_TABLE_NAME || 'agentlens-data-dev';

    if (docClient) {
      this.docClient = docClient;
    } else {
      const region = process.env.AWS_REGION || 'ap-southeast-2';
      const client = new DynamoDBClient({ region });
      this.docClient = DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true },
      });
    }
  }

  // ===================================================
  // Run Persistence Primitives
  // ===================================================

  async createRun(run: Run): Promise<Run> {
    // 1. Primary point lookup item: pk = RUN#<run_id>, sk = METADATA
    const primaryItem = {
      pk: `RUN#${run.run_id}`,
      sk: 'METADATA',
      entity_type: 'RUN',
      ...run,
    };

    // 2. Collection timeline item: pk = RUNS, sk = RUN#<created_at>#<run_id>
    const timelineItem = {
      pk: 'RUNS',
      sk: `RUN#${run.created_at}#${run.run_id}`,
      entity_type: 'RUN_INDEX',
      ...run,
    };

    // Atomic transaction ensuring both items are written together or neither is committed
    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: primaryItem,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: timelineItem,
            },
          },
        ],
      })
    );

    return run;
  }

  async getRun(run_id: string): Promise<Run | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `RUN#${run_id}`,
          sk: 'METADATA',
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const { pk, sk, entity_type, ...runData } = response.Item as Run & {
      pk: string;
      sk: string;
      entity_type: string;
    };

    return runData as Run;
  }

  async listRuns(limit = 50): Promise<Run[]> {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': 'RUNS',
        },
        ScanIndexForward: false, // Newest runs first
        Limit: limit,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map((item) => {
      const { pk, sk, entity_type, ...runData } = item as Run & {
        pk: string;
        sk: string;
        entity_type: string;
      };
      return runData as Run;
    });
  }

  // ===================================================
  // Telemetry Ingestion & Persistence Primitives
  // ===================================================

  async recordTelemetryEvents(run_id: string, events: TelemetryEvent[]): Promise<TelemetryEvent[]> {
    if (events.length === 0) {
      return [];
    }

    // Persist each event under the Run partition: pk = RUN#<run_id>, sk = EVENT#<timestamp>#<event_id>
    await Promise.all(
      events.map(async (event) => {
        const item = {
          pk: `RUN#${run_id}`,
          sk: `EVENT#${event.timestamp}#${event.event_id}`,
          entity_type: 'TELEMETRY_EVENT',
          ...event,
        };

        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: item,
          })
        );
      })
    );

    return events;
  }

  async getTelemetryEvents(run_id: string, limit = 100): Promise<TelemetryEvent[]> {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk_prefix)',
        ExpressionAttributeValues: {
          ':pk': `RUN#${run_id}`,
          ':sk_prefix': 'EVENT#',
        },
        ScanIndexForward: true, // Chronological: earliest to latest
        Limit: limit,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map((item) => {
      const { pk, sk, entity_type, ...eventData } = item as TelemetryEvent & {
        pk: string;
        sk: string;
        entity_type: string;
      };
      return eventData as TelemetryEvent;
    });
  }

  async updateRunTelemetry(
    run_id: string,
    updates: {
      status?: RunStatus;
      result?: string;
      error?: string;
      metrics?: Partial<ExecutionMetrics>;
      new_events_count?: number;
      updated_at: string;
    }
  ): Promise<Run | null> {
    const existingRun = await this.getRun(run_id);
    if (!existingRun) {
      return null;
    }

    const mergedMetrics: ExecutionMetrics | undefined =
      updates.metrics || existingRun.metrics
        ? {
            ...(existingRun.metrics || {}),
            ...(updates.metrics || {}),
          }
        : undefined;

    const updatedRun: Run = {
      ...existingRun,
      status: updates.status || existingRun.status,
      result: updates.result !== undefined ? updates.result : existingRun.result,
      error: updates.error !== undefined ? updates.error : existingRun.error,
      metrics: mergedMetrics,
      events_count: (existingRun.events_count || 0) + (updates.new_events_count || 0),
      updated_at: updates.updated_at,
    };

    await this.createRun(updatedRun);
    return updatedRun;
  }

  // ===================================================
  // Incident Persistence Primitives
  // ===================================================

  async createIncident(incident: Incident): Promise<Incident> {
    // 1. Direct point lookup: pk = INCIDENT#<id>, sk = METADATA
    const primaryItem = {
      pk: `INCIDENT#${incident.incident_id}`,
      sk: 'METADATA',
      entity_type: 'INCIDENT',
      ...incident,
    };

    // 2. Timeline index item: pk = INCIDENTS, sk = INCIDENT#<created_at>#<id>
    const collectionItem = {
      pk: 'INCIDENTS',
      sk: `INCIDENT#${incident.created_at}#${incident.incident_id}`,
      entity_type: 'INCIDENT_INDEX',
      ...incident,
    };

    // 3. Run-associated incident item: pk = RUN#<run_id>, sk = INCIDENT#<created_at>#<id>
    const runItem = {
      pk: `RUN#${incident.run_id}`,
      sk: `INCIDENT#${incident.created_at}#${incident.incident_id}`,
      entity_type: 'RUN_INCIDENT',
      ...incident,
    };

    // Atomic transaction ensuring all three items are written together or neither is committed
    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: primaryItem,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: collectionItem,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: runItem,
            },
          },
        ],
      })
    );

    return incident;
  }

  async getIncident(incident_id: string): Promise<Incident | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `INCIDENT#${incident_id}`,
          sk: 'METADATA',
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const { pk, sk, entity_type, ...incidentData } = response.Item as Incident & {
      pk: string;
      sk: string;
      entity_type: string;
    };

    return incidentData as Incident;
  }

  async listIncidents(limit = 50): Promise<Incident[]> {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': 'INCIDENTS',
        },
        ScanIndexForward: false, // Newest incidents first
        Limit: limit,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map((item) => {
      const { pk, sk, entity_type, ...incidentData } = item as Incident & {
        pk: string;
        sk: string;
        entity_type: string;
      };
      return incidentData as Incident;
    });
  }

  async listIncidentsByRun(run_id: string, limit = 50): Promise<Incident[]> {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `RUN#${run_id}`,
          ':skPrefix': 'INCIDENT#',
        },
        ScanIndexForward: false, // Newest incidents first
        Limit: limit,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map((item) => {
      const { pk, sk, entity_type, ...incidentData } = item as Incident & {
        pk: string;
        sk: string;
        entity_type: string;
      };
      return incidentData as Incident;
    });
  }

  async updateIncidentRca(
    incident_id: string,
    updates: {
      rca: IncidentRcaResult;
      status?: IncidentStatus;
      updated_at: string;
    }
  ): Promise<Incident | null> {
    // 1. Retrieve existing incident
    const existing = await this.getIncident(incident_id);
    if (!existing) {
      return null;
    }

    const updatedIncident: Incident = {
      ...existing,
      rca: updates.rca,
      status: updates.status || existing.status,
      updated_at: updates.updated_at,
    };

    // 2. Atomically update all three representations
    const primaryItem = {
      pk: `INCIDENT#${updatedIncident.incident_id}`,
      sk: 'METADATA',
      entity_type: 'INCIDENT',
      ...updatedIncident,
    };

    const collectionItem = {
      pk: 'INCIDENTS',
      sk: `INCIDENT#${updatedIncident.created_at}#${updatedIncident.incident_id}`,
      entity_type: 'INCIDENT_INDEX',
      ...updatedIncident,
    };

    const runItem = {
      pk: `RUN#${updatedIncident.run_id}`,
      sk: `INCIDENT#${updatedIncident.created_at}#${updatedIncident.incident_id}`,
      entity_type: 'RUN_INCIDENT',
      ...updatedIncident,
    };

    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: primaryItem,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: collectionItem,
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: runItem,
            },
          },
        ],
      })
    );

    return updatedIncident;
  }

  // ===================================================
  // Canonical Primitives for Future Phases
  // (RegressionTest, Evaluation, ReplayRecord)
  // ===================================================

  async createRegressionTest(test: RegressionTest): Promise<RegressionTest> {
    const item = {
      pk: `TEST#${test.test_id}`,
      sk: 'METADATA',
      entity_type: 'REGRESSION_TEST',
      ...test,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    return test;
  }

  async getRegressionTest(test_id: string): Promise<RegressionTest | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `TEST#${test_id}`,
          sk: 'METADATA',
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const { pk, sk, entity_type, ...testData } = response.Item as RegressionTest & {
      pk: string;
      sk: string;
      entity_type: string;
    };

    return testData as RegressionTest;
  }

  async createEvaluation(evaluation: Evaluation): Promise<Evaluation> {
    const item = {
      pk: `EVAL#${evaluation.evaluation_id}`,
      sk: 'METADATA',
      entity_type: 'EVALUATION',
      ...evaluation,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    return evaluation;
  }

  async getEvaluation(evaluation_id: string): Promise<Evaluation | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `EVAL#${evaluation_id}`,
          sk: 'METADATA',
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const { pk, sk, entity_type, ...evalData } = response.Item as Evaluation & {
      pk: string;
      sk: string;
      entity_type: string;
    };

    return evalData as Evaluation;
  }

  async createReplayRecord(record: ReplayRecord): Promise<ReplayRecord> {
    const item = {
      pk: `REPLAY#${record.replay_id}`,
      sk: 'METADATA',
      entity_type: 'REPLAY_RECORD',
      ...record,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    return record;
  }

  async getReplayRecord(replay_id: string): Promise<ReplayRecord | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `REPLAY#${replay_id}`,
          sk: 'METADATA',
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const { pk, sk, entity_type, ...replayData } = response.Item as ReplayRecord & {
      pk: string;
      sk: string;
      entity_type: string;
    };

    return replayData as ReplayRecord;
  }
}
