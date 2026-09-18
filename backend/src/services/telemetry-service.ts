import crypto from 'node:crypto';
import type {
  IngestTelemetryRequest,
  TelemetryEvent,
  TelemetryEventInput,
  TelemetryIngestionResult,
  RunStatus,
} from '../types/contracts.js';
import { CANONICAL_TELEMETRY_EVENT_TYPES } from '../types/contracts.js';
import type { IAgentLensRepository } from '../repository/agentlens-repository.js';

export class TelemetryValidationError extends Error {
  constructor(message: string, public readonly code: string = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'TelemetryValidationError';
  }
}

export class RunNotFoundError extends Error {
  constructor(run_id: string) {
    super(`Run with ID "${run_id}" not found.`);
    this.name = 'RunNotFoundError';
  }
}

export interface ITelemetryService {
  ingestRunTelemetry(run_id: string, payload: IngestTelemetryRequest): Promise<TelemetryIngestionResult>;
  getRunTelemetry(run_id: string, limit?: number): Promise<TelemetryEvent[]>;
}

export class TelemetryService implements ITelemetryService {
  constructor(private readonly repo: IAgentLensRepository) {}

  /**
   * Ingests telemetry events and/or execution status and metrics for an existing Run.
   *
   * Architecture Decisions:
   * 1. Event IDs: Uses generated unique IDs (evt_<randomUUID>) to guarantee collision-free
   *    writes across concurrent worker/agent calls without depending on millisecond timestamps.
   * 2. Canonical Types: Strictly validates against CANONICAL_TELEMETRY_EVENT_TYPES:
   *    ('tool_call', 'model_invocation', 'state_change', 'log', 'metric').
   * 3. Bounded Run Updates: Updates Run status, metrics, result, error, and event count only.
   *    Never creates incidents or triggers domain algorithms (Member 4 platform boundary).
   */
  async ingestRunTelemetry(
    run_id: string,
    payload: IngestTelemetryRequest
  ): Promise<TelemetryIngestionResult> {
    if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
      throw new TelemetryValidationError('Parameter "run_id" is required.', 'VALIDATION_ERROR');
    }

    const cleanRunId = run_id.trim();

    // 1. Verify target Run exists
    const existingRun = await this.repo.getRun(cleanRunId);
    if (!existingRun) {
      throw new RunNotFoundError(cleanRunId);
    }

    const now = new Date().toISOString();

    // 2. Validate and normalize incoming events (if provided)
    const normalizedEvents: TelemetryEvent[] = [];
    if (payload.events !== undefined) {
      if (!Array.isArray(payload.events)) {
        throw new TelemetryValidationError('Field "events" must be an array.', 'VALIDATION_ERROR');
      }

      for (let i = 0; i < payload.events.length; i++) {
        const rawEvent = payload.events[i] as Partial<TelemetryEventInput>;
        const event = this.validateAndNormalizeEvent(rawEvent, cleanRunId, i, now);
        normalizedEvents.push(event);
      }
    }

    // 3. Validate status if provided
    if (payload.status !== undefined) {
      const allowedStatuses: RunStatus[] = ['pending', 'running', 'completed', 'failed'];
      if (!allowedStatuses.includes(payload.status)) {
        throw new TelemetryValidationError(
          `Invalid status "${payload.status}". Allowed values: ${allowedStatuses.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }
    }

    // 4. Validate metrics if provided
    if (payload.metrics !== undefined) {
      if (typeof payload.metrics !== 'object' || payload.metrics === null || Array.isArray(payload.metrics)) {
        throw new TelemetryValidationError('Field "metrics" must be an object.', 'VALIDATION_ERROR');
      }

      for (const [key, value] of Object.entries(payload.metrics)) {
        if (value !== undefined && (typeof value !== 'number' || isNaN(value) || value < 0)) {
          throw new TelemetryValidationError(
            `Metric "${key}" must be a non-negative number.`,
            'VALIDATION_ERROR'
          );
        }
      }
    }

    // 5. Persist telemetry events into DynamoDB (pk = RUN#<run_id>, sk = EVENT#<timestamp>#<event_id>)
    if (normalizedEvents.length > 0) {
      await this.repo.recordTelemetryEvents(cleanRunId, normalizedEvents);
    }

    // 6. Apply bounded update to Run metadata (status, metrics, error, result, events_count)
    const updatedRun = await this.repo.updateRunTelemetry(cleanRunId, {
      status: payload.status,
      result: payload.result,
      error: payload.error,
      metrics: payload.metrics,
      new_events_count: normalizedEvents.length,
      updated_at: now,
    });

    const finalStatus = updatedRun ? updatedRun.status : existingRun.status;
    const totalEventsCount = updatedRun?.events_count ?? (existingRun.events_count || 0) + normalizedEvents.length;

    return {
      run_id: cleanRunId,
      ingested_events_count: normalizedEvents.length,
      total_events_count: totalEventsCount,
      status: finalStatus,
      updated_at: now,
    };
  }

  /**
   * Retrieves chronological telemetry events for a given Run.
   */
  async getRunTelemetry(run_id: string, limit = 100): Promise<TelemetryEvent[]> {
    if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
      throw new TelemetryValidationError('Parameter "run_id" is required.', 'VALIDATION_ERROR');
    }

    const cleanRunId = run_id.trim();

    // Verify run exists
    const existingRun = await this.repo.getRun(cleanRunId);
    if (!existingRun) {
      throw new RunNotFoundError(cleanRunId);
    }

    return this.repo.getTelemetryEvents(cleanRunId, limit);
  }

  private validateAndNormalizeEvent(
    raw: Partial<TelemetryEventInput>,
    run_id: string,
    index: number,
    defaultTimestamp: string
  ): TelemetryEvent {
    if (!raw || typeof raw !== 'object') {
      throw new TelemetryValidationError(`Event at index ${index} must be an object.`);
    }

    if (!raw.type || !CANONICAL_TELEMETRY_EVENT_TYPES.includes(raw.type)) {
      throw new TelemetryValidationError(
        `Event at index ${index} has invalid type "${raw.type}". Allowed canonical types: ${CANONICAL_TELEMETRY_EVENT_TYPES.join(', ')}`
      );
    }

    if (!raw.name || typeof raw.name !== 'string' || raw.name.trim().length === 0) {
      throw new TelemetryValidationError(`Event at index ${index} requires a non-empty string "name".`);
    }

    let timestamp = defaultTimestamp;
    if (raw.timestamp) {
      const parsed = Date.parse(raw.timestamp);
      if (isNaN(parsed)) {
        throw new TelemetryValidationError(
          `Event at index ${index} has invalid timestamp "${raw.timestamp}". Must be valid ISO 8601.`
        );
      }
      timestamp = new Date(parsed).toISOString();
    }

    if (raw.duration_ms !== undefined && (typeof raw.duration_ms !== 'number' || raw.duration_ms < 0)) {
      throw new TelemetryValidationError(`Event at index ${index} field "duration_ms" must be a non-negative number.`);
    }

    if (raw.status !== undefined && !['success', 'error', 'pending'].includes(raw.status)) {
      throw new TelemetryValidationError(`Event at index ${index} field "status" must be 'success', 'error', or 'pending'.`);
    }

    // Generated unique event ID guaranteeing uniqueness across concurrent invocations
    const event_id = `evt_${crypto.randomUUID().replace(/-/g, '')}`;

    return {
      event_id,
      run_id,
      timestamp,
      type: raw.type,
      name: raw.name.trim(),
      data: raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : undefined,
      duration_ms: raw.duration_ms,
      status: raw.status,
    };
  }
}
