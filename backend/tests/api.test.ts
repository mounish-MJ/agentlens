import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { AgentLensRepository, type IAgentLensRepository } from '../src/repository/agentlens-repository.js';
import { createHandler } from '../src/handler.js';
import { ApiController } from '../src/controllers/api-controller.js';
import type {
  Run,
  RunStatus,
  Incident,
  IncidentRcaResult,
  IncidentStatus,
  RegressionTest,
  Evaluation,
  ReplayRecord,
  TelemetryEvent,
  ExecutionMetrics,
} from '../../contracts/types.js';

/**
 * In-memory Mock Repository simulating DynamoDB Single-Table behavior for unit tests.
 */
class MockAgentLensRepository implements IAgentLensRepository {
  public runs = new Map<string, Run>();
  public telemetryEvents = new Map<string, TelemetryEvent[]>();
  public incidents = new Map<string, Incident>();
  public regressionTests = new Map<string, RegressionTest>();
  public evaluations = new Map<string, Evaluation>();
  public replayRecords = new Map<string, ReplayRecord>();

  async createRun(run: Run): Promise<Run> {
    this.runs.set(run.run_id, run);
    return run;
  }

  async getRun(run_id: string): Promise<Run | null> {
    return this.runs.get(run_id) || null;
  }

  async listRuns(limit = 50): Promise<Run[]> {
    return Array.from(this.runs.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  async recordTelemetryEvents(run_id: string, events: TelemetryEvent[]): Promise<TelemetryEvent[]> {
    const existing = this.telemetryEvents.get(run_id) || [];
    const updated = [...existing, ...events];
    this.telemetryEvents.set(run_id, updated);
    return events;
  }

  async getTelemetryEvents(run_id: string, limit = 100): Promise<TelemetryEvent[]> {
    const events = this.telemetryEvents.get(run_id) || [];
    return events.slice(0, limit);
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
    const existing = this.runs.get(run_id);
    if (!existing) return null;

    const mergedMetrics: ExecutionMetrics | undefined = updates.metrics || existing.metrics
      ? { ...(existing.metrics || {}), ...(updates.metrics || {}) }
      : undefined;

    const updated: Run = {
      ...existing,
      status: updates.status || existing.status,
      result: updates.result !== undefined ? updates.result : existing.result,
      error: updates.error !== undefined ? updates.error : existing.error,
      metrics: mergedMetrics,
      events_count: (existing.events_count || 0) + (updates.new_events_count || 0),
      updated_at: updates.updated_at,
    };
    this.runs.set(run_id, updated);
    return updated;
  }

  async createIncident(incident: Incident): Promise<Incident> {
    this.incidents.set(incident.incident_id, incident);
    return incident;
  }

  async getIncident(incident_id: string): Promise<Incident | null> {
    return this.incidents.get(incident_id) || null;
  }

  async listIncidents(_limit = 50): Promise<Incident[]> {
    return Array.from(this.incidents.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async listIncidentsByRun(run_id: string, limit = 50): Promise<Incident[]> {
    return Array.from(this.incidents.values())
      .filter((inc) => inc.run_id === run_id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  async updateIncidentRca(
    incident_id: string,
    updates: {
      rca?: IncidentRcaResult;
      status?: IncidentStatus;
      updated_at: string;
    }
  ): Promise<Incident | null> {
    const existing = this.incidents.get(incident_id);
    if (!existing) return null;
    const updated: Incident = {
      ...existing,
      ...(updates.rca !== undefined ? { rca: updates.rca } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      updated_at: updates.updated_at,
    };
    this.incidents.set(incident_id, updated);
    return updated;
  }

  async createRegressionTest(test: RegressionTest): Promise<RegressionTest> {
    this.regressionTests.set(test.test_id, test);
    return test;
  }

  async getRegressionTest(test_id: string): Promise<RegressionTest | null> {
    return this.regressionTests.get(test_id) || null;
  }

  async createEvaluation(evaluation: Evaluation): Promise<Evaluation> {
    this.evaluations.set(evaluation.evaluation_id, evaluation);
    return evaluation;
  }

  async getEvaluation(evaluation_id: string): Promise<Evaluation | null> {
    return this.evaluations.get(evaluation_id) || null;
  }

  async createReplayRecord(record: ReplayRecord): Promise<ReplayRecord> {
    this.replayRecords.set(record.replay_id, record);
    return record;
  }

  async getReplayRecord(replay_id: string): Promise<ReplayRecord | null> {
    return this.replayRecords.get(replay_id) || null;
  }
}

test('API Controller: POST /runs creates a real Run and persists it', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  const response = await controller.createRun({
    agent_name: 'test-agent',
    prompt: 'Analyze system log files',
    metadata: { environment: 'staging', model: 'claude-3-sonnet' },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.ok(response.body.data);
  assert.ok(response.body.data.run_id.startsWith('run_'));
  assert.equal(response.body.data.agent_name, 'test-agent');
  assert.equal(response.body.data.prompt, 'Analyze system log files');
  assert.equal(response.body.data.status, 'pending');

  // Verify it was persisted in the repository
  const stored = await mockRepo.getRun(response.body.data.run_id);
  assert.ok(stored);
  assert.equal(stored.run_id, response.body.data.run_id);
});

test('API Controller: POST /runs rejects missing or invalid fields', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  // Missing body
  const res1 = await controller.createRun(null);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.success, false);
  assert.equal(res1.body.error?.code, 'BAD_REQUEST');

  // Missing agent_name
  const res2 = await controller.createRun({ prompt: 'some prompt' });
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error?.code, 'VALIDATION_ERROR');

  // Empty agent_name
  const res3 = await controller.createRun({ agent_name: '   ', prompt: 'some prompt' });
  assert.equal(res3.statusCode, 400);
  assert.equal(res3.body.error?.code, 'VALIDATION_ERROR');

  // Missing prompt
  const res4 = await controller.createRun({ agent_name: 'valid-agent' });
  assert.equal(res4.statusCode, 400);
  assert.equal(res4.body.error?.code, 'VALIDATION_ERROR');
});

test('API Controller: GET /runs/{run_id} returns 200 for existing Run', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  const created = await mockRepo.createRun({
    run_id: 'run_abc123',
    agent_name: 'demo-agent',
    status: 'completed',
    prompt: 'Summarize ticket',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const res = await controller.getRun('run_abc123');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data?.run_id, created.run_id);
  assert.equal(res.body.data?.agent_name, 'demo-agent');
});

test('API Controller: GET /runs/{run_id} returns 404 when Run does not exist', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  const res = await controller.getRun('run_nonexistent');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error?.code, 'NOT_FOUND');
});

test('API Controller: GET /incidents returns empty array when no incidents exist', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  const res = await controller.listIncidents();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, []); // Never generates fake incidents!
});

test('API Controller: GET /incidents returns actual persisted incidents', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  await mockRepo.createIncident({
    incident_id: 'inc_101',
    run_id: 'run_101',
    title: 'Tool execution loop detected',
    severity: 'high',
    status: 'open',
    type: 'tool_loop',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const res = await controller.listIncidents();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data?.length, 1);
  assert.equal(res.body.data?.[0].incident_id, 'inc_101');
  assert.equal(res.body.data?.[0].type, 'tool_loop');
});

test('API Controller: GET /incidents/{incident_id} returns 404 when missing', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  const res = await controller.getIncident('inc_does_not_exist');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error?.code, 'NOT_FOUND');
});

test('Lambda Handler: End-to-end event routing via createHandler', async () => {
  const mockRepo = new MockAgentLensRepository();
  const handler = createHandler(mockRepo);

  // 1. POST /runs via Lambda proxy v2 event
  const postEvent = {
    rawPath: '/runs',
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify({ agent_name: 'lambda-agent', prompt: 'Execute trace' }),
    headers: {},
  };

  const postRes = (await handler(postEvent as any)) as any;
  assert.equal(postRes.statusCode, 201);
  const postBody = JSON.parse(postRes.body);
  assert.equal(postBody.success, true);
  const run_id = postBody.data.run_id;
  assert.ok(run_id);

  // 2. GET /runs/{run_id} via Lambda proxy v2 event
  const getEvent = {
    rawPath: `/runs/${run_id}`,
    requestContext: { http: { method: 'GET' } },
    headers: {},
  };

  const getRes = (await handler(getEvent as any)) as any;
  assert.equal(getRes.statusCode, 200);
  const getBody = JSON.parse(getRes.body);
  assert.equal(getBody.data.run_id, run_id);
  assert.equal(getBody.data.agent_name, 'lambda-agent');

  // 3. GET /incidents returns empty array
  const listIncidentsEvent = {
    rawPath: '/incidents',
    requestContext: { http: { method: 'GET' } },
    headers: {},
  };

  const listRes = (await handler(listIncidentsEvent as any)) as any;
  assert.equal(listRes.statusCode, 200);
  const listBody = JSON.parse(listRes.body);
  assert.deepEqual(listBody.data, []);

  // 4. GET /health
  const healthEvent = {
    rawPath: '/health',
    requestContext: { http: { method: 'GET' } },
    headers: {},
  };

  const healthRes = (await handler(healthEvent as any)) as any;
  assert.equal(healthRes.statusCode, 200);
  const healthBody = JSON.parse(healthRes.body);
  assert.equal(healthBody.status, 'ok');
});

test('Canonical Entity Persistence Primitives in Mock Repository', async () => {
  const mockRepo = new MockAgentLensRepository();

  // RegressionTest
  const testObj: RegressionTest = {
    test_id: 'test_1',
    name: 'Order Lookup Test',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await mockRepo.createRegressionTest(testObj);
  const fetchedTest = await mockRepo.getRegressionTest('test_1');
  assert.equal(fetchedTest?.name, 'Order Lookup Test');

  // Evaluation
  const evalObj: Evaluation = {
    evaluation_id: 'eval_1',
    run_id: 'run_1',
    metrics: { accuracy: 0.95, passed: true },
    passed: true,
    created_at: new Date().toISOString(),
  };
  await mockRepo.createEvaluation(evalObj);
  const fetchedEval = await mockRepo.getEvaluation('eval_1');
  assert.equal(fetchedEval?.passed, true);

  // ReplayRecord
  const replayObj: ReplayRecord = {
    replay_id: 'replay_1',
    run_id: 'run_1',
    state_snapshot: { step: 1, action: 'search' },
    created_at: new Date().toISOString(),
  };
  await mockRepo.createReplayRecord(replayObj);
  const fetchedReplay = await mockRepo.getReplayRecord('replay_1');
  assert.equal(fetchedReplay?.run_id, 'run_1');
});

test('API Controller: POST /runs/{run_id}/telemetry ingests events, updates metrics and status', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  // 1. Create a run first
  const runRes = await controller.createRun({
    agent_name: 'test-agent',
    prompt: 'Execute search task',
  });
  assert.equal(runRes.statusCode, 201);
  const runId = runRes.body.data!.run_id;

  // 2. Ingest telemetry
  const telemetryPayload = {
    status: 'completed',
    result: 'Task completed successfully',
    metrics: {
      prompt_tokens: 250,
      completion_tokens: 100,
      total_tokens: 350,
      duration_ms: 1200,
      tool_calls_count: 2,
    },
    events: [
      {
        type: 'tool_call',
        name: 'database_lookup',
        data: { query: 'SELECT * FROM items' },
        duration_ms: 45,
        status: 'success',
      },
      {
        type: 'model_invocation',
        name: 'anthropic.claude-3-haiku',
        data: { tokens: 350 },
        duration_ms: 800,
        status: 'success',
      },
    ],
  };

  const ingestRes = await controller.ingestTelemetry(runId, telemetryPayload);
  assert.equal(ingestRes.statusCode, 200);
  assert.equal(ingestRes.body.success, true);
  assert.equal(ingestRes.body.data?.run_id, runId);
  assert.equal(ingestRes.body.data?.ingested_events_count, 2);
  assert.equal(ingestRes.body.data?.total_events_count, 2);
  assert.equal(ingestRes.body.data?.status, 'completed');

  // 3. Verify Run itself was updated in repository
  const fetchedRun = await mockRepo.getRun(runId);
  assert.equal(fetchedRun?.status, 'completed');
  assert.equal(fetchedRun?.result, 'Task completed successfully');
  assert.equal(fetchedRun?.events_count, 2);
  assert.equal(fetchedRun?.metrics?.total_tokens, 350);
  assert.equal(fetchedRun?.metrics?.duration_ms, 1200);

  // 4. Verify GET /runs/{run_id}/telemetry returns events
  const getTelemetryRes = await controller.getRunTelemetry(runId);
  assert.equal(getTelemetryRes.statusCode, 200);
  assert.equal(getTelemetryRes.body.success, true);
  assert.equal(getTelemetryRes.body.data?.length, 2);
  assert.equal(getTelemetryRes.body.data![0].name, 'database_lookup');
  assert.equal(getTelemetryRes.body.data![0].type, 'tool_call');
  assert.ok(getTelemetryRes.body.data![0].event_id.startsWith('evt_'));
});

test('API Controller: POST /runs/{run_id}/telemetry validates input and handles 404', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  // Non-existent run -> 404
  const notFoundRes = await controller.ingestTelemetry('run_missing_123', {
    events: [{ type: 'tool_call', name: 'search' }],
  });
  assert.equal(notFoundRes.statusCode, 404);
  assert.equal(notFoundRes.body.error?.code, 'NOT_FOUND');

  // Create real run to test validation
  const runRes = await controller.createRun({
    agent_name: 'test-agent',
    prompt: 'Run test prompt',
  });
  const runId = runRes.body.data!.run_id;

  // Invalid event type -> 400
  const invalidTypeRes = await controller.ingestTelemetry(runId, {
    events: [{ type: 'arbitrary_fake_type' as any, name: 'tool' }],
  });
  assert.equal(invalidTypeRes.statusCode, 400);
  assert.equal(invalidTypeRes.body.error?.code, 'VALIDATION_ERROR');

  // Missing event name -> 400
  const missingNameRes = await controller.ingestTelemetry(runId, {
    events: [{ type: 'tool_call', name: '' }],
  });
  assert.equal(missingNameRes.statusCode, 400);

  // Invalid metric value -> 400
  const invalidMetricRes = await controller.ingestTelemetry(runId, {
    metrics: { total_tokens: -10 },
  });
  assert.equal(invalidMetricRes.statusCode, 400);
});

test('Lambda Handler: routes POST and GET /runs/{run_id}/telemetry', async () => {
  const mockRepo = new MockAgentLensRepository();
  const handler = createHandler(mockRepo);

  // 1. Create a Run via Lambda POST /runs
  const createRunEvent = {
    rawPath: '/runs',
    requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent_name: 'lambda-agent', prompt: 'Lambda prompt' }),
  };
  const createRes = (await handler(createRunEvent as any)) as any;
  assert.equal(createRes.statusCode, 201);
  const runId = JSON.parse(createRes.body).data.run_id;

  // 2. Ingest telemetry via Lambda POST /runs/{run_id}/telemetry
  const telemetryEvent = {
    rawPath: `/runs/${runId}/telemetry`,
    requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status: 'completed',
      events: [
        { type: 'tool_call', name: 'calculate_tax', data: { amount: 100 } },
        { type: 'metric', name: 'latency', data: { value: 120 } },
      ],
    }),
  };
  const ingestRes = (await handler(telemetryEvent as any)) as any;
  assert.equal(ingestRes.statusCode, 200);
  const ingestBody = JSON.parse(ingestRes.body);
  assert.equal(ingestBody.data.ingested_events_count, 2);

  // 3. Query telemetry via Lambda GET /runs/{run_id}/telemetry
  const getTelemetryEvent = {
    rawPath: `/runs/${runId}/telemetry`,
    requestContext: { http: { method: 'GET' } },
    headers: {},
  };
  const getRes = (await handler(getTelemetryEvent as any)) as any;
  assert.equal(getRes.statusCode, 200);
  const getBody = JSON.parse(getRes.body);
  assert.equal(getBody.data.length, 2);
  assert.equal(getBody.data[0].name, 'calculate_tax');

  // 4. Verify GET /runs/{run_id} still works and shows completed status
  const getRunEvent = {
    rawPath: `/runs/${runId}`,
    requestContext: { http: { method: 'GET' } },
    headers: {},
  };
  const getRunRes = (await handler(getRunEvent as any)) as any;
  assert.equal(getRunRes.statusCode, 200);
  const getRunBody = JSON.parse(getRunRes.body);
  assert.equal(getRunBody.data.status, 'completed');
  assert.equal(getRunBody.data.events_count, 2);
});

test('API Controller: GET /runs returns empty array when no runs exist', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  const res = await controller.listRuns();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, []);
});

test('API Controller: GET /runs returns chronological list of runs with sensible limit', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  await controller.createRun({ agent_name: 'agent-1', prompt: 'Prompt 1' });
  await new Promise((r) => setTimeout(r, 5));
  await controller.createRun({ agent_name: 'agent-2', prompt: 'Prompt 2' });
  await new Promise((r) => setTimeout(r, 5));
  await controller.createRun({ agent_name: 'agent-3', prompt: 'Prompt 3' });

  // List all
  const res = await controller.listRuns();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data?.length, 3);
  // Newest first
  assert.equal(res.body.data![0].agent_name, 'agent-3');

  // Limit = 2
  const limitRes = await controller.listRuns('2');
  assert.equal(limitRes.statusCode, 200);
  assert.equal(limitRes.body.data?.length, 2);
});

test('API Controller: GET /runs validates limit query parameter and rejects invalid input', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  // Negative limit
  const negRes = await controller.listRuns('-5');
  assert.equal(negRes.statusCode, 400);
  assert.equal(negRes.body.error?.code, 'VALIDATION_ERROR');

  // Zero limit
  const zeroRes = await controller.listRuns('0');
  assert.equal(zeroRes.statusCode, 400);

  // Non-numeric limit
  const nonNumRes = await controller.listRuns('invalid_num');
  assert.equal(nonNumRes.statusCode, 400);

  // Exceeding max limit (> 100)
  const exceedRes = await controller.listRuns('500');
  assert.equal(exceedRes.statusCode, 400);

  // Non-integer float/decimal limit
  const decimalRes = await controller.listRuns('1.5');
  assert.equal(decimalRes.statusCode, 400);
  assert.equal(decimalRes.body.error?.code, 'VALIDATION_ERROR');
});

test('API Controller: GET /runs accepts valid boundary limits (limit=1 and limit=100)', async () => {
  const mockRepo = new MockAgentLensRepository();
  const controller = new ApiController(mockRepo);

  await controller.createRun({ agent_name: 'agent-1', prompt: 'Prompt 1' });
  await controller.createRun({ agent_name: 'agent-2', prompt: 'Prompt 2' });

  // Boundary: limit=1
  const limit1Res = await controller.listRuns('1');
  assert.equal(limit1Res.statusCode, 200);
  assert.equal(limit1Res.body.success, true);
  assert.equal(limit1Res.body.data?.length, 1);

  // Boundary: limit=100
  const limit100Res = await controller.listRuns('100');
  assert.equal(limit100Res.statusCode, 200);
  assert.equal(limit100Res.body.success, true);
  assert.equal(limit100Res.body.data?.length, 2);
});

test('Lambda Handler: routes GET /runs with query parameters', async () => {
  const mockRepo = new MockAgentLensRepository();
  const handler = createHandler(mockRepo);

  await mockRepo.createRun({
    run_id: 'run_lambda_1',
    agent_name: 'lambda-test',
    status: 'pending',
    prompt: 'Prompt',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const getRunsEvent = {
    rawPath: '/runs',
    requestContext: { http: { method: 'GET' } },
    headers: {},
    queryStringParameters: { limit: '10' },
  };

  const res = (await handler(getRunsEvent as any)) as any;
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].run_id, 'run_lambda_1');
});

test('AgentLensRepository: createRun writes primary Run and RUNS timeline item in a single TransactWriteCommand', async () => {
  let capturedCommand: any = null;

  const mockDocClient = {
    send: async (command: any) => {
      capturedCommand = command;
      return {};
    },
  } as any;

  const repo = new AgentLensRepository(mockDocClient, 'agentlens-test-table');

  const run: Run = {
    run_id: 'run_tx_123',
    agent_name: 'test-agent',
    status: 'pending',
    prompt: 'Transaction test',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  };

  const result = await repo.createRun(run);
  assert.equal(result.run_id, 'run_tx_123');

  assert.ok(capturedCommand instanceof TransactWriteCommand, 'Expected TransactWriteCommand to be used');
  const items = capturedCommand.input.TransactItems;
  assert.equal(items.length, 2);

  // 1. Primary Run item: pk = RUN#<run_id>, sk = METADATA
  assert.equal(items[0].Put.TableName, 'agentlens-test-table');
  assert.equal(items[0].Put.Item.pk, 'RUN#run_tx_123');
  assert.equal(items[0].Put.Item.sk, 'METADATA');
  assert.equal(items[0].Put.Item.entity_type, 'RUN');
  assert.equal(items[0].Put.Item.run_id, 'run_tx_123');
  assert.equal(items[0].Put.Item.agent_name, 'test-agent');

  // 2. RUNS timeline item: pk = RUNS, sk = RUN#<created_at>#<run_id>
  assert.equal(items[1].Put.TableName, 'agentlens-test-table');
  assert.equal(items[1].Put.Item.pk, 'RUNS');
  assert.equal(items[1].Put.Item.sk, 'RUN#2026-09-18T10:00:00.000Z#run_tx_123');
  assert.equal(items[1].Put.Item.entity_type, 'RUN_INDEX');
  assert.equal(items[1].Put.Item.run_id, 'run_tx_123');
});

test('AgentLensRepository: createRun propagates transaction error if TransactWriteCommand fails', async () => {
  const mockDocClient = {
    send: async () => {
      throw new Error('TransactionCanceledException: Transaction cancelled');
    },
  } as any;

  const repo = new AgentLensRepository(mockDocClient, 'agentlens-test-table');

  const run: Run = {
    run_id: 'run_tx_fail',
    agent_name: 'test-agent',
    status: 'pending',
    prompt: 'Transaction fail test',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  };

  await assert.rejects(
    async () => {
      await repo.createRun(run);
    },
    { message: /TransactionCanceledException/ }
  );
});
