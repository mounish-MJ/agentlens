import crypto from 'node:crypto';
import type {
  ApiResponse,
  Run,
  CreateRunRequest,
  Incident,
  CreateIncidentRequest,
  UpdateIncidentRcaRequest,
  HealthCheckResponse,
  TelemetryEvent,
  TelemetryIngestionResult,
  IngestTelemetryRequest,
} from '../types/contracts.js';
import type { IAgentLensRepository } from '../repository/agentlens-repository.js';
import {
  type ITelemetryService,
  TelemetryService,
  TelemetryValidationError,
  RunNotFoundError,
} from '../services/telemetry-service.js';
import {
  type IIncidentService,
  IncidentService,
  IncidentValidationError,
  IncidentNotFoundError,
  RcaServiceUnavailableError,
} from '../services/incident-service.js';

export interface ControllerResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string>;
  body: ApiResponse<T>;
}

const COMMON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
};

export class ApiController {
  private readonly telemetryService: ITelemetryService;
  private readonly incidentService: IIncidentService;

  constructor(
    private readonly repo: IAgentLensRepository,
    customTelemetryService?: ITelemetryService,
    customIncidentService?: IIncidentService
  ) {
    this.telemetryService = customTelemetryService || new TelemetryService(this.repo);
    this.incidentService = customIncidentService || new IncidentService(this.repo);
  }

  // ==========================================
  // GET /health
  // ==========================================
  async getHealth(): Promise<ControllerResponse<HealthCheckResponse>> {
    const healthData: HealthCheckResponse = {
      status: 'ok',
      service: 'agentlens-backend',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      region: process.env.AWS_REGION || 'ap-southeast-2',
      table: process.env.DYNAMODB_TABLE_NAME || 'agentlens-data-dev',
    };

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: {
        success: true,
        data: healthData,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // ==========================================
  // POST /runs
  // ==========================================
  async createRun(rawBody: unknown): Promise<ControllerResponse<Run>> {
    const now = new Date().toISOString();

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Request body must be a valid JSON object.',
          },
          timestamp: now,
        },
      };
    }

    const { agent_name, prompt, metadata } = rawBody as Partial<CreateRunRequest>;

    if (!agent_name || typeof agent_name !== 'string' || agent_name.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Field "agent_name" is required and must be a non-empty string.',
          },
          timestamp: now,
        },
      };
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Field "prompt" is required and must be a non-empty string.',
          },
          timestamp: now,
        },
      };
    }

    const run_id = `run_${crypto.randomUUID().replace(/-/g, '')}`;

    const newRun: Run = {
      run_id,
      agent_name: agent_name.trim(),
      status: 'pending',
      prompt: prompt.trim(),
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : undefined,
      created_at: now,
      updated_at: now,
    };

    try {
      const persistedRun = await this.repo.createRun(newRun);
      return {
        statusCode: 201,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: persistedRun,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      console.error('[ApiController] Error creating Run in DynamoDB:', err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to persist Run in data store.',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  // ==========================================
  // GET /runs
  // ==========================================
  async listRuns(limitStr?: string): Promise<ControllerResponse<Run[]>> {
    const now = new Date().toISOString();
    let limit: number | undefined = undefined;

    if (limitStr !== undefined && limitStr !== null && limitStr !== '') {
      const trimmed = limitStr.trim();
      if (!/^\d+$/.test(trimmed)) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Query parameter "limit" must be a positive integer between 1 and 100.',
            },
            timestamp: now,
          },
        };
      }

      limit = parseInt(trimmed, 10);
      if (limit <= 0 || limit > 100) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Query parameter "limit" must be a positive integer between 1 and 100.',
            },
            timestamp: now,
          },
        };
      }
    }

    try {
      const runs = await this.repo.listRuns(limit);
      return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: runs,
          timestamp: now,
        },
      };
    } catch (err: unknown) {
      console.error('[ApiController] Error listing Runs:', err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to list Runs from data store.',
          },
          timestamp: now,
        },
      };
    }
  }

  // ==========================================
  // GET /runs/{run_id}
  // ==========================================
  async getRun(run_id?: string): Promise<ControllerResponse<Run>> {
    const now = new Date().toISOString();

    if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parameter "run_id" is required.',
          },
          timestamp: now,
        },
      };
    }

    try {
      const run = await this.repo.getRun(run_id.trim());

      if (!run) {
        return {
          statusCode: 404,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: `Run with ID "${run_id}" not found.`,
            },
            timestamp: now,
          },
        };
      }

      return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: run,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      console.error(`[ApiController] Error retrieving Run ${run_id}:`, err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to retrieve Run from data store.',
          },
          timestamp: now,
        },
      };
    }
  }

  // ==========================================
  // GET /incidents
  // ==========================================
  async listIncidents(limitStr?: string, runIdStr?: string): Promise<ControllerResponse<Incident[]>> {
    const now = new Date().toISOString();
    let limit: number | undefined = undefined;

    if (limitStr !== undefined && limitStr !== null && limitStr !== '') {
      const trimmed = limitStr.trim();
      if (!/^\d+$/.test(trimmed)) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Query parameter "limit" must be a positive integer between 1 and 100.',
            },
            timestamp: now,
          },
        };
      }

      limit = parseInt(trimmed, 10);
      if (limit <= 0 || limit > 100) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Query parameter "limit" must be a positive integer between 1 and 100.',
            },
            timestamp: now,
          },
        };
      }
    }

    const cleanRunId = runIdStr && typeof runIdStr === 'string' ? runIdStr.trim() : undefined;

    try {
      const incidents = await this.incidentService.listIncidents(limit, cleanRunId);

      return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: incidents, // returns empty array if none, never fake data!
          timestamp: now,
        },
      };
    } catch (err: unknown) {
      console.error('[ApiController] Error listing Incidents:', err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to list Incidents from data store.',
          },
          timestamp: now,
        },
      };
    }
  }

  // ==========================================
  // GET /incidents/{incident_id}
  // ==========================================
  async getIncident(incident_id?: string): Promise<ControllerResponse<Incident>> {
    const now = new Date().toISOString();

    if (!incident_id || typeof incident_id !== 'string' || incident_id.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parameter "incident_id" is required.',
          },
          timestamp: now,
        },
      };
    }

    try {
      const incident = await this.incidentService.getIncident(incident_id.trim());

      if (!incident) {
        return {
          statusCode: 404,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: `Incident with ID "${incident_id}" not found.`,
            },
            timestamp: now,
          },
        };
      }

      return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: incident,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof IncidentValidationError) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      console.error(`[ApiController] Error retrieving Incident ${incident_id}:`, err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to retrieve Incident from data store.',
          },
          timestamp: now,
        },
      };
    }
  }

  // ==========================================
  // POST /incidents
  // ==========================================
  async createIncident(rawBody: unknown): Promise<ControllerResponse<Incident>> {
    const now = new Date().toISOString();

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Request body must be a valid JSON object.',
          },
          timestamp: now,
        },
      };
    }

    try {
      const created = await this.incidentService.createIncident(rawBody as CreateIncidentRequest);
      return {
        statusCode: 201,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: created,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof RunNotFoundError) {
        return {
          statusCode: 404,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      if (err instanceof IncidentValidationError) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: err.code || 'VALIDATION_ERROR',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      console.error('[ApiController] Error creating Incident:', err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to persist Incident in data store.',
          },
          timestamp: now,
        },
      };
    }
  }

  // ==========================================
  // POST /incidents/:incident_id/rca
  // ==========================================
  async updateIncidentRca(
    incident_id?: string,
    rawBody?: unknown
  ): Promise<ControllerResponse<Incident>> {
    const now = new Date().toISOString();

    if (!incident_id || typeof incident_id !== 'string' || incident_id.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parameter "incident_id" is required.',
          },
          timestamp: now,
        },
      };
    }

    const payload = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? (rawBody as UpdateIncidentRcaRequest)
      : ({} as UpdateIncidentRcaRequest);

    try {
      const updated = await this.incidentService.updateIncidentRca(incident_id.trim(), payload);
      return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: updated,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof IncidentNotFoundError) {
        return {
          statusCode: 404,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      if (err instanceof RcaServiceUnavailableError) {
        return {
          statusCode: 501,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: err.code,
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      if (err instanceof IncidentValidationError) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: err.code || 'VALIDATION_ERROR',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      console.error(`[ApiController] Error updating RCA for Incident ${incident_id}:`, err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to update Incident RCA in data store.',
          },
          timestamp: now,
        },
      };
    }
  }

  // ==========================================
  // GET /runs/:run_id/incidents
  // ==========================================
  async listIncidentsByRun(
    run_id?: string,
    limitStr?: string
  ): Promise<ControllerResponse<Incident[]>> {
    const now = new Date().toISOString();

    if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parameter "run_id" is required.',
          },
          timestamp: now,
        },
      };
    }

    return this.listIncidents(limitStr, run_id);
  }

  // ==========================================
  // POST /runs/{run_id}/telemetry
  // ==========================================
  async ingestTelemetry(
    run_id?: string,
    rawBody?: unknown
  ): Promise<ControllerResponse<TelemetryIngestionResult>> {
    const now = new Date().toISOString();

    if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parameter "run_id" is required.',
          },
          timestamp: now,
        },
      };
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Request body must be a valid JSON object.',
          },
          timestamp: now,
        },
      };
    }

    try {
      const result = await this.telemetryService.ingestRunTelemetry(
        run_id.trim(),
        rawBody as IngestTelemetryRequest
      );

      return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: result,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof RunNotFoundError) {
        return {
          statusCode: 404,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      if (err instanceof TelemetryValidationError) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: err.code || 'VALIDATION_ERROR',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      console.error(`[ApiController] Error ingesting telemetry for Run ${run_id}:`, err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to ingest telemetry into data store.',
          },
          timestamp: now,
        },
      };
    }
  }

  // ==========================================
  // GET /runs/{run_id}/telemetry
  // ==========================================
  async getRunTelemetry(
    run_id?: string,
    limitStr?: string
  ): Promise<ControllerResponse<TelemetryEvent[]>> {
    const now = new Date().toISOString();

    if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Parameter "run_id" is required.',
          },
          timestamp: now,
        },
      };
    }

    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Query parameter "limit" must be a positive integer.',
          },
          timestamp: now,
        },
      };
    }

    try {
      const events = await this.telemetryService.getRunTelemetry(run_id.trim(), limit);

      return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: {
          success: true,
          data: events,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof RunNotFoundError) {
        return {
          statusCode: 404,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      if (err instanceof TelemetryValidationError) {
        return {
          statusCode: 400,
          headers: COMMON_HEADERS,
          body: {
            success: false,
            error: {
              code: err.code || 'VALIDATION_ERROR',
              message: err.message,
            },
            timestamp: now,
          },
        };
      }

      console.error(`[ApiController] Error retrieving telemetry for Run ${run_id}:`, err);
      return {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to retrieve telemetry from data store.',
          },
          timestamp: now,
        },
      };
    }
  }
}
