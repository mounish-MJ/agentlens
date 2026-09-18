import test from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryService, TelemetryValidationError, RunNotFoundError } from '../src/services/telemetry-service.js';
import type { IAgentLensRepository } from '../src/repository/agentlens-repository.js';
import type {
  Run,
  RunStatus,
  Incident,
  RegressionTest,
  Evaluation,
  ReplayRecord,
  TelemetryEvent,
  ExecutionMetrics,
} from '../src/types/contracts.js';

class MockTelemetryRepo implements IAgentLensRepository {
  public runs = new Map<string, Run>();
  public events = new Map<string, TelemetryEvent[]>();

  async createRun(run: Run): Promise<Run> {
    this.runs.set(run.run_id, run);
    return run;
  }

  async getRun(run_id: string): Promise<Run | null> {
    return this.runs.get(run_id) || null;
  }

  async recordTelemetryEvents(run_id: string, newEvents: TelemetryEvent[]): Promise<TelemetryEvent[]> {
    const list = this.events.get(run_id) || [];
    this.events.set(run_id, [...list, ...newEvents]);
    return newEvents;
  }

  async getTelemetryEvents(run_id: string, limit = 100): Promise<TelemetryEvent[]> {
    const list = this.events.get(run_id) || [];
    return list.slice(0, limit);
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

    const mergedMetrics = updates.metrics || existing.metrics
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

  async createIncident(i: Incident): Promise<Incident> { return i; }
  async getIncident(): Promise<Incident | null> { return null; }
  async listIncidents(): Promise<Incident[]> { return []; }
  async createRegressionTest(t: RegressionTest): Promise<RegressionTest> { return t; }
  async getRegressionTest(): Promise<RegressionTest | null> { return null; }
  async createEvaluation(e: Evaluation): Promise<Evaluation> { return e; }
  async getEvaluation(): Promise<Evaluation | null> { return null; }
  async createReplayRecord(r: ReplayRecord): Promise<ReplayRecord> { return r; }
  async getReplayRecord(): Promise<ReplayRecord | null> { return null; }
}

test('TelemetryService: ingests valid telemetry batch and assigns unique IDs', async () => {
  const repo = new MockTelemetryRepo();
  const service = new TelemetryService(repo);

  await repo.createRun({
    run_id: 'run_test_1',
    agent_name: 'test-agent',
    status: 'running',
    prompt: 'Process item',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const res = await service.ingestRunTelemetry('run_test_1', {
    status: 'completed',
    result: 'Success',
    metrics: {
      prompt_tokens: 120,
      completion_tokens: 80,
      total_tokens: 200,
      tool_calls_count: 1,
    },
    events: [
      {
        type: 'tool_call',
        name: 'fetch_data',
        data: { id: 123 },
        duration_ms: 50,
        status: 'success',
      },
      {
        type: 'log',
        name: 'info',
        data: { message: 'Finished step' },
      },
    ],
  });

  assert.equal(res.run_id, 'run_test_1');
  assert.equal(res.ingested_events_count, 2);
  assert.equal(res.total_events_count, 2);
  assert.equal(res.status, 'completed');

  const events = await service.getRunTelemetry('run_test_1');
  assert.equal(events.length, 2);
  assert.equal(events[0].name, 'fetch_data');
  assert.equal(events[0].type, 'tool_call');
  assert.ok(events[0].event_id.startsWith('evt_'));
  assert.ok(events[1].event_id.startsWith('evt_'));
  assert.notEqual(events[0].event_id, events[1].event_id, 'Event IDs must be unique');
});

test('TelemetryService: strictly validates canonical event types', async () => {
  const repo = new MockTelemetryRepo();
  const service = new TelemetryService(repo);

  await repo.createRun({
    run_id: 'run_test_types',
    agent_name: 'test-agent',
    status: 'running',
    prompt: 'Testing event types',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Valid canonical event types must succeed
  const validTypes = ['tool_call', 'model_invocation', 'state_change', 'log', 'metric'] as const;
  for (const t of validTypes) {
    const res = await service.ingestRunTelemetry('run_test_types', {
      events: [{ type: t, name: `event_${t}` }],
    });
    assert.equal(res.ingested_events_count, 1);
  }

  // Non-canonical event type must throw TelemetryValidationError
  await assert.rejects(
    async () => {
      await service.ingestRunTelemetry('run_test_types', {
        events: [{ type: 'unsupported_random_type' as any, name: 'invalid' }],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof TelemetryValidationError);
      assert.match(err.message, /invalid type/i);
      return true;
    }
  );
});

test('TelemetryService: throws RunNotFoundError when target Run does not exist', async () => {
  const repo = new MockTelemetryRepo();
  const service = new TelemetryService(repo);

  await assert.rejects(
    async () => {
      await service.ingestRunTelemetry('non_existent_run', {
        events: [{ type: 'log', name: 'heartbeat' }],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof RunNotFoundError);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await service.getRunTelemetry('non_existent_run');
    },
    (err: unknown) => {
      assert.ok(err instanceof RunNotFoundError);
      return true;
    }
  );
});

test('TelemetryService: keeps Run updates strictly bounded without creating incidents', async () => {
  const repo = new MockTelemetryRepo();
  const service = new TelemetryService(repo);

  await repo.createRun({
    run_id: 'run_bounded',
    agent_name: 'test-agent',
    status: 'running',
    prompt: 'Process with error',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Ingest failure telemetry with an error event
  await service.ingestRunTelemetry('run_bounded', {
    status: 'failed',
    error: 'Execution timed out',
    events: [
      {
        type: 'log',
        name: 'error_log',
        data: { reason: 'timeout after 30s' },
        status: 'error',
      },
    ],
  });

  const run = await repo.getRun('run_bounded');
  assert.equal(run?.status, 'failed');
  assert.equal(run?.error, 'Execution timed out');
  assert.equal(run?.events_count, 1);

  // Verify that repository incidents list remains completely untouched
  const incidents = await repo.listIncidents();
  assert.equal(incidents.length, 0, 'TelemetryService must NOT fabricate incidents');
});
