/**
 * Shared foundation contracts for AgentLens.
 * Business domain contracts will be added here as APIs and persistence models are defined.
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  timestamp: string;
  environment: string;
}
