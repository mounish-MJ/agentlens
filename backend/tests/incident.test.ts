import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactWriteCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { AgentLensRepository, type IAgentLensRepository } from '../src/repository/agentlens-repository.js';
import { IncidentService, RcaServiceUnavailableError, RunNotFoundError, IncidentValidationError } from '../src/services/incident-service.js';
import { ApiController } from '../src/controllers/api-controller.js';
import { createHandler } from '../src/handler.js';
import type {
  Run,
  RunStatus,
  Incident,
  IncidentEvidenceItem,
  IncidentRcaResult,
  CreateIncidentRequest,
  UpdateIncidentRcaRequest,
  ExecutionMetrics,
  TelemetryEvent,
  RegressionTest,
  Evaluation,
  ReplayRecord,
} from '../src/types/contracts.js';

/**
 * In-memory Mock Repository for unit testing controller and service logic.
 */
class MockIncidentRepository implements IAgentLensRepository {
  public runs = new Map<string, Run>();
  public incidents = new Map<string, Incident>();
  public telemetryEvents = new Map<string, TelemetryEvent[]>();

  async createRun(run: Run): Promise<Run> {
    this.runs.set(run.run_id, run);
    return run;
  }

  async getRun(run_id: string): Promise<Run | null> {
    return this.runs.get(run_id) || null;
  }

  async listRuns(_limit = 50): Promise<Run[]> {
    return Array.from(this.runs.values());
  }

  async recordTelemetryEvents(run_id: string, events: TelemetryEvent[]): Promise<TelemetryEvent[]> {
    this.telemetryEvents.set(run_id, events);
    return events;
  }

  async getTelemetryEvents(run_id: string): Promise<TelemetryEvent[]> {
    return this.telemetryEvents.get(run_id) || [];
  }

  async updateRunTelemetry(): Promise<Run | null> {
    return null;
  }

  async createIncident(incident: Incident): Promise<Incident> {
    this.incidents.set(incident.incident_id, incident);
    return incident;
  }

  async getIncident(incident_id: string): Promise<Incident | null> {
    return this.incidents.get(incident_id) || null;
  }

  async listIncidents(limit = 50): Promise<Incident[]> {
    return Array.from(this.incidents.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
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
      status?: any;
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

  async createRegressionTest(t: RegressionTest): Promise<RegressionTest> { return t; }
  async getRegressionTest(): Promise<RegressionTest | null> { return null; }
  async createEvaluation(e: Evaluation): Promise<Evaluation> { return e; }
  async getEvaluation(): Promise<Evaluation | null> { return null; }
  async createReplayRecord(r: ReplayRecord): Promise<ReplayRecord> { return r; }
  async getReplayRecord(): Promise<ReplayRecord | null> { return null; }
}

// -------------------------------------------------------------
// 1. GET /incidents with empty collection
// -------------------------------------------------------------
test('Incident API: GET /incidents returns empty array when no incidents exist', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const res = await controller.listIncidents();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, []);
});

// -------------------------------------------------------------
// 2. GET /incidents with persisted incidents
// -------------------------------------------------------------
test('Incident API: GET /incidents returns chronological persisted incidents', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const inc1: Incident = {
    incident_id: 'inc_001',
    run_id: 'run_100',
    title: 'Tool execution failure',
    type: 'tool_loop',
    severity: 'high',
    status: 'open',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  };
  const inc2: Incident = {
    incident_id: 'inc_002',
    run_id: 'run_100',
    title: 'Context overflow',
    type: 'token_anomaly',
    severity: 'critical',
    status: 'open',
    created_at: '2026-09-18T11:00:00.000Z',
    updated_at: '2026-09-18T11:00:00.000Z',
  };

  await repo.createIncident(inc1);
  await repo.createIncident(inc2);

  const res = await controller.listIncidents();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 2);
  // Newer incident first
  assert.equal(res.body.data[0].incident_id, 'inc_002');
  assert.equal(res.body.data[1].incident_id, 'inc_001');
});

// -------------------------------------------------------------
// 3. GET /incidents/:id valid
// -------------------------------------------------------------
test('Incident API: GET /incidents/:id returns 200 for existing incident', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const inc: Incident = {
    incident_id: 'inc_valid_123',
    run_id: 'run_200',
    title: 'Database connection timeout',
    type: 'network_failure',
    severity: 'medium',
    status: 'investigating',
    detector_source: 'retrieval_detector',
    confidence: 0.95,
    evidence: [
      { event_id: 'evt_1', type: 'tool_call', name: 'query_db', metric: 'latency_ms', value: 5200 },
    ],
    created_at: '2026-09-18T12:00:00.000Z',
    updated_at: '2026-09-18T12:00:00.000Z',
  };
  await repo.createIncident(inc);

  const res = await controller.getIncident('inc_valid_123');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.incident_id, 'inc_valid_123');
  assert.equal(res.body.data.detector_source, 'retrieval_detector');
  assert.equal(res.body.data.confidence, 0.95);
  assert.equal(res.body.data.evidence.length, 1);
});

// -------------------------------------------------------------
// 4. GET /incidents/:id missing -> 404
// -------------------------------------------------------------
test('Incident API: GET /incidents/:id returns 404 when incident does not exist', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const res = await controller.getIncident('inc_non_existent');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error?.code, 'NOT_FOUND');
});

// -------------------------------------------------------------
// 5. POST /incidents missing run -> validation failure (404 RunNotFoundError)
// -------------------------------------------------------------
test('Incident API: POST /incidents rejects with 404 when referenced Run does not exist', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const payload: CreateIncidentRequest = {
    run_id: 'run_ghost_missing',
    title: 'Ghost Run Incident',
    type: 'tool_loop',
    severity: 'high',
  };

  const res = await controller.createIncident(payload);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error?.code, 'NOT_FOUND');
  assert.match(res.body.error?.message, /Run with ID "run_ghost_missing" not found/);
});

// -------------------------------------------------------------
// 6. POST /incidents invalid severity
// -------------------------------------------------------------
test('Incident API: POST /incidents rejects invalid severity with 400', async () => {
  const repo = new MockIncidentRepository();
  await repo.createRun({
    run_id: 'run_valid_1',
    agent_name: 'test-agent',
    status: 'running',
    prompt: 'test prompt',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const controller = new ApiController(repo);

  const payload = {
    run_id: 'run_valid_1',
    title: 'Test Incident',
    type: 'tool_loop',
    severity: 'catastrophic', // invalid severity
  };

  const res = await controller.createIncident(payload);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  assert.match(res.body.error?.message, /severity/i);
});

// -------------------------------------------------------------
// 7. POST /incidents invalid type
// -------------------------------------------------------------
test('Incident API: POST /incidents rejects missing or invalid type with 400', async () => {
  const repo = new MockIncidentRepository();
  await repo.createRun({
    run_id: 'run_valid_2',
    agent_name: 'test-agent',
    status: 'running',
    prompt: 'test prompt',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const controller = new ApiController(repo);

  // Missing type
  const res1 = await controller.createIncident({
    run_id: 'run_valid_2',
    title: 'Missing Type',
    severity: 'medium',
  });
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.error?.code, 'VALIDATION_ERROR');

  // Empty string type
  const res2 = await controller.createIncident({
    run_id: 'run_valid_2',
    title: 'Empty Type',
    type: '   ',
    severity: 'medium',
  });
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error?.code, 'VALIDATION_ERROR');
});

// -------------------------------------------------------------
// 8. POST /incidents valid
// -------------------------------------------------------------
test('Incident API: POST /incidents persists canonical incident and returns 201', async () => {
  const repo = new MockIncidentRepository();
  await repo.createRun({
    run_id: 'run_valid_3',
    agent_name: 'test-agent',
    status: 'running',
    prompt: 'test prompt',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const controller = new ApiController(repo);

  const evidenceItem: IncidentEvidenceItem = {
    event_id: 'evt_99',
    timestamp: new Date().toISOString(),
    type: 'tool_call',
    name: 'fetch_web',
    details: { url: 'https://example.com/api', status_code: 500 },
    metric: 'retry_count',
    value: 5,
  };

  const payload: CreateIncidentRequest = {
    run_id: 'run_valid_3',
    title: 'Repeated HTTP 500 tool failure',
    summary: 'Agent caught in retry loop exceeding 5 attempts',
    type: 'tool_loop',
    severity: 'high',
    detector_source: 'detector_tool_loop_v1',
    confidence: 0.98,
    evidence: [evidenceItem],
  };

  const res = await controller.createIncident(payload);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.incident_id.startsWith('inc_'));
  assert.equal(res.body.data.title, 'Repeated HTTP 500 tool failure');
  assert.equal(res.body.data.severity, 'high');
  assert.equal(res.body.data.detector_source, 'detector_tool_loop_v1');
  assert.equal(res.body.data.confidence, 0.98);
  assert.equal(res.body.data.evidence.length, 1);
  assert.equal(res.body.data.status, 'open');

  // Verify persistence in repo
  const persisted = await repo.getIncident(res.body.data.incident_id);
  assert.ok(persisted);
  assert.equal(persisted.incident_id, res.body.data.incident_id);
});

// -------------------------------------------------------------
// 9. Atomic persistence creates all three representations
// -------------------------------------------------------------
test('AgentLensRepository: createIncident writes all 3 representations via single TransactWriteCommand', async () => {
  let capturedCommand: any = null;

  const mockDocClient = {
    send: async (command: any) => {
      capturedCommand = command;
      return {};
    },
  } as any;

  const repo = new AgentLensRepository(mockDocClient, 'agentlens-test-table');

  const incident: Incident = {
    incident_id: 'inc_atom_123',
    run_id: 'run_atom_456',
    title: 'Atomic Write Test',
    type: 'wrong_tool',
    severity: 'medium',
    status: 'open',
    detector_source: 'detector_test',
    confidence: 0.85,
    created_at: '2026-09-18T14:30:00.000Z',
    updated_at: '2026-09-18T14:30:00.000Z',
  };

  const result = await repo.createIncident(incident);
  assert.equal(result.incident_id, 'inc_atom_123');

  assert.ok(capturedCommand instanceof TransactWriteCommand, 'Expected TransactWriteCommand to be used');
  const items = capturedCommand.input.TransactItems;
  assert.equal(items.length, 3, 'TransactItems must contain exactly 3 representations');

  // Representation 1: Direct incident lookup
  assert.equal(items[0].Put.TableName, 'agentlens-test-table');
  assert.equal(items[0].Put.Item.pk, 'INCIDENT#inc_atom_123');
  assert.equal(items[0].Put.Item.sk, 'METADATA');
  assert.equal(items[0].Put.Item.entity_type, 'INCIDENT');
  assert.equal(items[0].Put.Item.incident_id, 'inc_atom_123');
  assert.equal(items[0].Put.Item.run_id, 'run_atom_456');

  // Representation 2: Recent incident timeline
  assert.equal(items[1].Put.TableName, 'agentlens-test-table');
  assert.equal(items[1].Put.Item.pk, 'INCIDENTS');
  assert.equal(items[1].Put.Item.sk, 'INCIDENT#2026-09-18T14:30:00.000Z#inc_atom_123');
  assert.equal(items[1].Put.Item.entity_type, 'INCIDENT_INDEX');
  assert.equal(items[1].Put.Item.incident_id, 'inc_atom_123');

  // Representation 3: Incidents belonging to a run
  assert.equal(items[2].Put.TableName, 'agentlens-test-table');
  assert.equal(items[2].Put.Item.pk, 'RUN#run_atom_456');
  assert.equal(items[2].Put.Item.sk, 'INCIDENT#2026-09-18T14:30:00.000Z#inc_atom_123');
  assert.equal(items[2].Put.Item.entity_type, 'RUN_INCIDENT');
  assert.equal(items[2].Put.Item.incident_id, 'inc_atom_123');
});

// -------------------------------------------------------------
// 10. GET /runs/:run_id/incidents
// -------------------------------------------------------------
test('Incident API: GET /runs/:run_id/incidents returns incidents for target run', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const inc1: Incident = {
    incident_id: 'inc_r1',
    run_id: 'run_alpha',
    title: 'Alpha Incident',
    type: 'tool_loop',
    severity: 'low',
    status: 'open',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  };
  const inc2: Incident = {
    incident_id: 'inc_r2',
    run_id: 'run_beta',
    title: 'Beta Incident',
    type: 'token_anomaly',
    severity: 'high',
    status: 'open',
    created_at: '2026-09-18T11:00:00.000Z',
    updated_at: '2026-09-18T11:00:00.000Z',
  };
  await repo.createIncident(inc1);
  await repo.createIncident(inc2);

  const resAlpha = await controller.listIncidentsByRun('run_alpha');
  assert.equal(resAlpha.statusCode, 200);
  assert.equal(resAlpha.body.data.length, 1);
  assert.equal(resAlpha.body.data[0].incident_id, 'inc_r1');

  const resBeta = await controller.listIncidentsByRun('run_beta');
  assert.equal(resBeta.statusCode, 200);
  assert.equal(resBeta.body.data.length, 1);
  assert.equal(resBeta.body.data[0].incident_id, 'inc_r2');
});

// -------------------------------------------------------------
// 11. GET /incidents?run_id=<id>
// -------------------------------------------------------------
test('Incident API: GET /incidents?run_id=<id> filters by run correctly', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  await repo.createIncident({
    incident_id: 'inc_q1',
    run_id: 'run_filtered',
    title: 'Filtered 1',
    type: 'tool_loop',
    severity: 'medium',
    status: 'open',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  });
  await repo.createIncident({
    incident_id: 'inc_q2',
    run_id: 'run_filtered',
    title: 'Filtered 2',
    type: 'tool_loop',
    severity: 'low',
    status: 'open',
    created_at: '2026-09-18T11:00:00.000Z',
    updated_at: '2026-09-18T11:00:00.000Z',
  });
  await repo.createIncident({
    incident_id: 'inc_q3',
    run_id: 'run_other',
    title: 'Other Run',
    type: 'tool_loop',
    severity: 'high',
    status: 'open',
    created_at: '2026-09-18T12:00:00.000Z',
    updated_at: '2026-09-18T12:00:00.000Z',
  });

  const res = await controller.listIncidents('50', 'run_filtered');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 2);
  assert.ok(res.body.data.every((i: Incident) => i.run_id === 'run_filtered'));
});

// -------------------------------------------------------------
// 12. RCA structured payload persistence
// -------------------------------------------------------------
test('Incident API: POST /incidents/:id/rca persists structured RCA payload', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const initialIncident: Incident = {
    incident_id: 'inc_rca_target',
    run_id: 'run_rca_1',
    title: 'Tool execution failure',
    type: 'tool_loop',
    severity: 'high',
    status: 'open',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  };
  await repo.createIncident(initialIncident);

  const rcaPayload: IncidentRcaResult = {
    primary_failure: 'Exceeded maximum retry limit on search tool',
    root_cause: 'API endpoint returned 429 rate limit errors without exponential backoff',
    contributing_factors: ['Missing jitter in agent retry loop', 'Under-provisioned query quota'],
    severity: 'high',
    impact: 'Agent unable to complete research workflow',
    recommended_action: 'Implement exponential backoff with jitter and cache search results',
    evidence_used: ['evt_tool_search_1', 'evt_tool_search_2'],
    uncertainty: 'low',
    analyzed_at: '2026-09-18T10:05:00.000Z',
  };

  const req: UpdateIncidentRcaRequest = {
    rca: rcaPayload,
    status: 'resolved',
  };

  const res = await controller.updateIncidentRca('inc_rca_target', req);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'resolved');
  assert.ok(res.body.data.rca);
  assert.equal(res.body.data.rca.primary_failure, 'Exceeded maximum retry limit on search tool');
  assert.equal(res.body.data.rca.root_cause, 'API endpoint returned 429 rate limit errors without exponential backoff');
  assert.equal(res.body.data.rca.contributing_factors.length, 2);
});

// -------------------------------------------------------------
// 13. RCA update preserves existing incident fields
// -------------------------------------------------------------
test('Incident API: RCA update preserves existing incident metadata without data loss', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const initialIncident: Incident = {
    incident_id: 'inc_preserve_test',
    run_id: 'run_orig_1',
    title: 'Original Title',
    summary: 'Original Summary',
    type: 'token_anomaly',
    severity: 'critical',
    status: 'investigating',
    detector_source: 'detector_tokens_v2',
    confidence: 0.99,
    evidence: [{ event_id: 'evt_1', type: 'model_invocation', metric: 'tokens', value: 8192 }],
    created_at: '2026-09-18T08:00:00.000Z',
    updated_at: '2026-09-18T08:00:00.000Z',
  };
  await repo.createIncident(initialIncident);

  await controller.updateIncidentRca('inc_preserve_test', {
    rca: {
      primary_failure: 'Prompt inflation',
      root_cause: 'Unbounded context concatenation',
      analyzed_at: '2026-09-18T08:10:00.000Z',
    },
  });

  const updated = await repo.getIncident('inc_preserve_test');
  assert.ok(updated);
  assert.equal(updated.title, 'Original Title');
  assert.equal(updated.summary, 'Original Summary');
  assert.equal(updated.type, 'token_anomaly');
  assert.equal(updated.severity, 'critical');
  assert.equal(updated.detector_source, 'detector_tokens_v2');
  assert.equal(updated.confidence, 0.99);
  assert.equal(updated.evidence?.length, 1);
  assert.equal(updated.rca?.primary_failure, 'Prompt inflation');
});

// -------------------------------------------------------------
// 14. Missing incident RCA update -> 404
// -------------------------------------------------------------
test('Incident API: POST /incidents/:id/rca returns 404 for missing incident', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  const res = await controller.updateIncidentRca('inc_ghost_404', {
    rca: {
      primary_failure: 'Failure',
      root_cause: 'Cause',
      analyzed_at: '2026-09-18T10:00:00.000Z',
    },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error?.code, 'NOT_FOUND');
});

// -------------------------------------------------------------
// 15. Automated RCA request -> 501 RCA_SERVICE_NOT_INTEGRATED
// -------------------------------------------------------------
test('Incident API: POST /incidents/:id/rca with trigger_automated_rca returns 501', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  await repo.createIncident({
    incident_id: 'inc_automated_test',
    run_id: 'run_test_auto',
    title: 'Auto RCA Test',
    type: 'tool_loop',
    severity: 'medium',
    status: 'open',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  });

  const res = await controller.updateIncidentRca('inc_automated_test', {
    trigger_automated_rca: true,
  });

  assert.equal(res.statusCode, 501);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error?.code, 'RCA_SERVICE_NOT_INTEGRATED');
  assert.match(res.body.error?.message, /Automated Bedrock RCA is not integrated/);
  assert.match(res.body.error?.message, /Member 2/);
});

// -------------------------------------------------------------
// 16. Empty/automated RCA request never generates fake RCA
// -------------------------------------------------------------
test('Incident API: Empty body to RCA endpoint returns 501 and does not fabricate fake RCA', async () => {
  const repo = new MockIncidentRepository();
  const controller = new ApiController(repo);

  await repo.createIncident({
    incident_id: 'inc_no_fake_test',
    run_id: 'run_test_nofake',
    title: 'No Fake RCA Test',
    type: 'tool_loop',
    severity: 'medium',
    status: 'open',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  });

  // Empty payload
  const res = await controller.updateIncidentRca('inc_no_fake_test', {});
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.error?.code, 'RCA_SERVICE_NOT_INTEGRATED');

  // Verify incident in repo was NOT modified with fake RCA
  const incident = await repo.getIncident('inc_no_fake_test');
  assert.ok(incident);
  assert.equal(incident.rca, undefined, 'RCA must remain undefined when automated RCA is requested');
});

// -------------------------------------------------------------
// 17. Lambda routing for every new endpoint
// -------------------------------------------------------------
test('Lambda Handler: End-to-end routing for all Phase 6 Incident endpoints', async () => {
  const repo = new MockIncidentRepository();
  const lambdaHandler = createHandler(repo);

  // Setup Run and Incident
  await repo.createRun({
    run_id: 'run_lambda_phase6',
    agent_name: 'test-agent',
    status: 'running',
    prompt: 'test prompt',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  });

  // A. POST /incidents
  const postIncEvent = {
    path: '/incidents',
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      run_id: 'run_lambda_phase6',
      title: 'Lambda Route Incident',
      type: 'tool_loop',
      severity: 'high',
      incident_id: 'inc_lambda_01',
    }),
    queryStringParameters: null,
  };
  const postIncRes = await lambdaHandler(postIncEvent as any);
  assert.equal(postIncRes.statusCode, 201);
  const postIncBody = JSON.parse(postIncRes.body);
  assert.equal(postIncBody.data.incident_id, 'inc_lambda_01');

  // B. GET /incidents
  const getIncsEvent = {
    path: '/incidents',
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: null,
    body: null,
  };
  const getIncsRes = await lambdaHandler(getIncsEvent as any);
  assert.equal(getIncsRes.statusCode, 200);
  const getIncsBody = JSON.parse(getIncsRes.body);
  assert.equal(getIncsBody.data.length, 1);

  // C. GET /incidents/:incident_id
  const getSingleIncEvent = {
    path: '/incidents/inc_lambda_01',
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: null,
    body: null,
  };
  const getSingleIncRes = await lambdaHandler(getSingleIncEvent as any);
  assert.equal(getSingleIncRes.statusCode, 200);
  const getSingleIncBody = JSON.parse(getSingleIncRes.body);
  assert.equal(getSingleIncBody.data.incident_id, 'inc_lambda_01');

  // D. GET /runs/:run_id/incidents
  const getRunIncsEvent = {
    path: '/runs/run_lambda_phase6/incidents',
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: null,
    body: null,
  };
  const getRunIncsRes = await lambdaHandler(getRunIncsEvent as any);
  assert.equal(getRunIncsRes.statusCode, 200);
  const getRunIncsBody = JSON.parse(getRunIncsRes.body);
  assert.equal(getRunIncsBody.data.length, 1);
  assert.equal(getRunIncsBody.data[0].incident_id, 'inc_lambda_01');

  // E. POST /incidents/:incident_id/rca (Structured payload -> 200)
  const postRcaEvent = {
    path: '/incidents/inc_lambda_01/rca',
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rca: {
        primary_failure: 'Lambda test failure',
        root_cause: 'Lambda test root cause',
        analyzed_at: '2026-09-18T10:15:00.000Z',
      },
    }),
    queryStringParameters: null,
  };
  const postRcaRes = await lambdaHandler(postRcaEvent as any);
  assert.equal(postRcaRes.statusCode, 200);
  const postRcaBody = JSON.parse(postRcaRes.body);
  assert.equal(postRcaBody.data.rca.primary_failure, 'Lambda test failure');

  // F. POST /incidents/:incident_id/rca (Automated trigger -> 501)
  const postAutoRcaEvent = {
    path: '/incidents/inc_lambda_01/rca',
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trigger_automated_rca: true }),
    queryStringParameters: null,
  };
  const postAutoRcaRes = await lambdaHandler(postAutoRcaEvent as any);
  assert.equal(postAutoRcaRes.statusCode, 501);
  const postAutoRcaBody = JSON.parse(postAutoRcaRes.body);
  assert.equal(postAutoRcaBody.error.code, 'RCA_SERVICE_NOT_INTEGRATED');
});

// -------------------------------------------------------------
// 18. No ScanCommand in incident persistence/listing implementation
// -------------------------------------------------------------
test('DynamoDB Single-Table Design: Zero ScanCommand in repository implementation', async () => {
  const commandsSent: any[] = [];

  const mockDocClient = {
    send: async (command: any) => {
      commandsSent.push(command);
      if (command instanceof QueryCommand) {
        return { Items: [] };
      }
      if (command instanceof GetCommand) {
        return {
          Item: {
            pk: 'INCIDENT#inc_scan_check',
            sk: 'METADATA',
            incident_id: 'inc_scan_check',
            run_id: 'run_test',
            created_at: '2026-09-18T10:00:00.000Z',
            updated_at: '2026-09-18T10:00:00.000Z',
          },
        };
      }
      return {};
    },
  } as any;

  const repo = new AgentLensRepository(mockDocClient, 'agentlens-test-table');

  // 1. Create incident
  await repo.createIncident({
    incident_id: 'inc_scan_check',
    run_id: 'run_test',
    title: 'Scan Check',
    type: 'tool_loop',
    severity: 'low',
    status: 'open',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
  });

  // 2. List incidents
  await repo.listIncidents(25);

  // 3. List incidents by run
  await repo.listIncidentsByRun('run_test', 25);

  // 4. Update RCA
  await repo.updateIncidentRca('inc_scan_check', {
    rca: {
      primary_failure: 'Test',
      root_cause: 'Test',
      analyzed_at: '2026-09-18T10:00:00.000Z',
    },
    updated_at: '2026-09-18T10:05:00.000Z',
  });

  // Verify none of the commands sent are ScanCommand
  for (const cmd of commandsSent) {
    assert.notEqual(cmd.constructor.name, 'ScanCommand', 'ScanCommand must NEVER be used in application code');
  }

  // Verify specific zero-scan access patterns
  const listCmd = commandsSent.find((c) => c instanceof QueryCommand && c.input.ExpressionAttributeValues[':pk'] === 'INCIDENTS');
  assert.ok(listCmd, 'listIncidents must use QueryCommand with pk=INCIDENTS');
  assert.equal(listCmd.input.ScanIndexForward, false, 'listIncidents must sort chronologically descending');

  const runCmd = commandsSent.find((c) => c instanceof QueryCommand && c.input.ExpressionAttributeValues[':pk'] === 'RUN#run_test');
  assert.ok(runCmd, 'listIncidentsByRun must use QueryCommand with pk=RUN#run_test');
  assert.ok(runCmd.input.KeyConditionExpression.includes('begins_with'), 'listIncidentsByRun must use begins_with on sk');
});
