import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  Run,
  Incident,
  RegressionTest,
  Evaluation,
  ReplayRecord,
} from '../types/contracts.js';

export interface IAgentLensRepository {
  createRun(run: Run): Promise<Run>;
  getRun(run_id: string): Promise<Run | null>;
  createIncident(incident: Incident): Promise<Incident>;
  getIncident(incident_id: string): Promise<Incident | null>;
  listIncidents(limit?: number): Promise<Incident[]>;
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
    const item = {
      pk: `RUN#${run.run_id}`,
      sk: 'METADATA',
      entity_type: 'RUN',
      ...run,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
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

  // ===================================================
  // Incident Persistence Primitives
  // ===================================================

  async createIncident(incident: Incident): Promise<Incident> {
    // 1. Write direct lookup item: pk = INCIDENT#<id>, sk = METADATA
    const primaryItem = {
      pk: `INCIDENT#${incident.incident_id}`,
      sk: 'METADATA',
      entity_type: 'INCIDENT',
      ...incident,
    };

    // 2. Write collection index item: pk = INCIDENTS, sk = INCIDENT#<created_at>#<id>
    const collectionItem = {
      pk: 'INCIDENTS',
      sk: `INCIDENT#${incident.created_at}#${incident.incident_id}`,
      entity_type: 'INCIDENT_INDEX',
      ...incident,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: primaryItem,
      })
    );

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: collectionItem,
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
        ScanIndexForward: false, // newest incidents first
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
