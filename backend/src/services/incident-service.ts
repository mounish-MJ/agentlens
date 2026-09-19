import crypto from 'node:crypto';
import type {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentEvidenceItem,
  IncidentRcaResult,
  CreateIncidentRequest,
  UpdateIncidentRcaRequest,
} from '../types/contracts.js';
import type { IAgentLensRepository } from '../repository/agentlens-repository.js';
import { RunNotFoundError } from './telemetry-service.js';

export { RunNotFoundError };

export class IncidentValidationError extends Error {
  constructor(message: string, public readonly code: string = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'IncidentValidationError';
  }
}

export class IncidentNotFoundError extends Error {
  constructor(incident_id: string) {
    super(`Incident with ID "${incident_id}" not found.`);
    this.name = 'IncidentNotFoundError';
  }
}

export class RcaServiceUnavailableError extends Error {
  public readonly code: string = 'RCA_SERVICE_NOT_INTEGRATED';

  constructor(
    message: string = 'Automated Bedrock RCA is not integrated into the Member 4 platform boundary and is owned by Member 2.'
  ) {
    super(message);
    this.name = 'RcaServiceUnavailableError';
  }
}

export interface IIncidentService {
  createIncident(payload: CreateIncidentRequest): Promise<Incident>;
  getIncident(incident_id: string): Promise<Incident | null>;
  listIncidents(limit?: number, run_id?: string): Promise<Incident[]>;
  updateIncidentRca(incident_id: string, payload: UpdateIncidentRcaRequest): Promise<Incident>;
}

export class IncidentService implements IIncidentService {
  constructor(private readonly repo: IAgentLensRepository) {}

  /**
   * Validates and persists a canonical Incident emitted by detectors or upstream workflows.
   * Enforces that referenced Run exists and all fields match canonical contracts.
   */
  async createIncident(payload: CreateIncidentRequest): Promise<Incident> {
    const validated = await this.validateIncidentInput(payload);

    const now = new Date().toISOString();
    const incident_id = validated.incident_id && validated.incident_id.trim().length > 0
      ? validated.incident_id.trim()
      : `inc_${crypto.randomUUID().replace(/-/g, '')}`;

    const incident: Incident = {
      incident_id,
      run_id: validated.run_id,
      title: validated.title,
      severity: validated.severity,
      status: validated.status || 'open',
      type: validated.type,
      summary: validated.summary,
      detector_source: validated.detector_source,
      confidence: validated.confidence,
      evidence: validated.evidence,
      rca: undefined,
      created_at: now,
      updated_at: now,
    };

    return this.repo.createIncident(incident);
  }

  /**
   * Retrieves a single incident by incident_id.
   */
  async getIncident(incident_id: string): Promise<Incident | null> {
    if (!incident_id || typeof incident_id !== 'string' || incident_id.trim().length === 0) {
      throw new IncidentValidationError('Parameter "incident_id" is required.');
    }
    return this.repo.getIncident(incident_id.trim());
  }

  /**
   * Lists recent incidents or incidents associated with a specific run.
   */
  async listIncidents(limit?: number, run_id?: string): Promise<Incident[]> {
    if (run_id && run_id.trim().length > 0) {
      return this.repo.listIncidentsByRun(run_id.trim(), limit);
    }
    return this.repo.listIncidents(limit);
  }

  /**
   * Handles the RCA update boundary.
   * Case A: Real structured RCA payload -> Validates and updates the incident.
   * Case B: Automated RCA trigger request -> Throws RcaServiceUnavailableError (mapped to HTTP 501).
   */
  async updateIncidentRca(
    incident_id: string,
    payload: UpdateIncidentRcaRequest
  ): Promise<Incident> {
    if (!incident_id || typeof incident_id !== 'string' || incident_id.trim().length === 0) {
      throw new IncidentValidationError('Parameter "incident_id" is required.');
    }

    const cleanIncidentId = incident_id.trim();
    const existing = await this.repo.getIncident(cleanIncidentId);
    if (!existing) {
      throw new IncidentNotFoundError(cleanIncidentId);
    }

    // Case B: Automated RCA trigger request or empty body without RCA payload
    if (payload?.trigger_automated_rca === true || !payload?.rca || typeof payload.rca !== 'object') {
      throw new RcaServiceUnavailableError();
    }

    // Case A: Real structured RCA payload provided
    const rca = payload.rca;

    if (!rca.primary_failure || typeof rca.primary_failure !== 'string' || rca.primary_failure.trim().length === 0) {
      throw new IncidentValidationError('RCA field "primary_failure" is required and must be a non-empty string.');
    }

    if (!rca.root_cause || typeof rca.root_cause !== 'string' || rca.root_cause.trim().length === 0) {
      throw new IncidentValidationError('RCA field "root_cause" is required and must be a non-empty string.');
    }

    if (payload.status !== undefined) {
      const validStatuses: IncidentStatus[] = ['open', 'investigating', 'resolved'];
      if (!validStatuses.includes(payload.status)) {
        throw new IncidentValidationError(
          `Invalid status "${payload.status}". Allowed values: ${validStatuses.join(', ')}.`
        );
      }
    }

    const validatedRca: IncidentRcaResult = {
      primary_failure: rca.primary_failure.trim(),
      root_cause: rca.root_cause.trim(),
      contributing_factors: Array.isArray(rca.contributing_factors)
        ? rca.contributing_factors.filter((f): f is string => typeof f === 'string')
        : undefined,
      severity: rca.severity,
      impact: typeof rca.impact === 'string' ? rca.impact : undefined,
      recommended_action: typeof rca.recommended_action === 'string' ? rca.recommended_action : undefined,
      evidence_used: Array.isArray(rca.evidence_used)
        ? rca.evidence_used.filter((e): e is string => typeof e === 'string')
        : undefined,
      uncertainty: rca.uncertainty,
      analyzed_at: rca.analyzed_at || new Date().toISOString(),
    };

    const now = new Date().toISOString();
    const updated = await this.repo.updateIncidentRca(cleanIncidentId, {
      rca: validatedRca,
      status: payload.status,
      updated_at: now,
    });

    if (!updated) {
      throw new IncidentNotFoundError(cleanIncidentId);
    }

    return updated;
  }

  /**
   * Internal validation of CreateIncidentRequest payload.
   */
  private async validateIncidentInput(
    payload: CreateIncidentRequest
  ): Promise<CreateIncidentRequest> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new IncidentValidationError('Request body must be a valid JSON object.');
    }

    const { run_id, title, severity, type, summary, status, detector_source, confidence, evidence, incident_id } = payload;

    // 1. Validate run_id
    if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
      throw new IncidentValidationError('Field "run_id" is required and must be a non-empty string.');
    }
    const cleanRunId = run_id.trim();

    // Verify referenced Run exists
    const referencedRun = await this.repo.getRun(cleanRunId);
    if (!referencedRun) {
      throw new RunNotFoundError(cleanRunId);
    }

    // 2. Validate title
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw new IncidentValidationError('Field "title" is required and must be a non-empty string.');
    }

    // 3. Validate severity
    const validSeverities: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];
    if (!severity || !validSeverities.includes(severity)) {
      throw new IncidentValidationError(
        `Field "severity" is required and must be one of: ${validSeverities.join(', ')}.`
      );
    }

    // 4. Validate type
    if (!type || typeof type !== 'string' || type.trim().length === 0) {
      throw new IncidentValidationError('Field "type" is required and must be a non-empty string.');
    }

    // 5. Validate status if provided
    if (status !== undefined) {
      const validStatuses: IncidentStatus[] = ['open', 'investigating', 'resolved'];
      if (!validStatuses.includes(status)) {
        throw new IncidentValidationError(
          `Field "status" must be one of: ${validStatuses.join(', ')}.`
        );
      }
    }

    // 6. Validate confidence if provided
    if (confidence !== undefined) {
      if (typeof confidence !== 'number' || isNaN(confidence) || confidence < 0 || confidence > 1) {
        throw new IncidentValidationError('Field "confidence" must be a number between 0 and 1.');
      }
    }

    // 7. Validate evidence if provided
    let validatedEvidence: IncidentEvidenceItem[] | undefined = undefined;
    if (evidence !== undefined) {
      if (!Array.isArray(evidence)) {
        throw new IncidentValidationError('Field "evidence" must be an array.');
      }

      validatedEvidence = evidence.map((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new IncidentValidationError(`Evidence item at index ${idx} must be an object.`);
        }
        return {
          event_id: typeof item.event_id === 'string' ? item.event_id : undefined,
          timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
          type: typeof item.type === 'string' ? item.type : undefined,
          name: typeof item.name === 'string' ? item.name : undefined,
          details: item.details && typeof item.details === 'object' && !Array.isArray(item.details)
            ? item.details as Record<string, unknown>
            : undefined,
          metric: typeof item.metric === 'string' ? item.metric : undefined,
          value: item.value,
        };
      });
    }

    return {
      run_id: cleanRunId,
      title: title.trim(),
      severity,
      type: type.trim(),
      summary: typeof summary === 'string' ? summary.trim() : undefined,
      status: status || 'open',
      detector_source: typeof detector_source === 'string' ? detector_source.trim() : undefined,
      confidence,
      evidence: validatedEvidence,
      incident_id: typeof incident_id === 'string' && incident_id.trim().length > 0 ? incident_id.trim() : undefined,
    };
  }
}
