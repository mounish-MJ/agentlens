import test from 'node:test';
import assert from 'node:assert/strict';
import type { IAgentLensRepository } from '../src/repository/agentlens-repository.js';
import { createHandler } from '../src/handler.js';
import { ApiController } from '../src/controllers/api-controller.js';
import type {
  Run,
  Incident,
  RegressionTest,
  Evaluation,
  ReplayRecord,
} from '../../contracts/types.js';

/**
 * In-memory Mock Repository simulating DynamoDB Single-Table behavior for unit tests.
 */
class MockAgentLensRepository implements IAgentLensRepository {
  public runs = new Map<string, Run>();
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
