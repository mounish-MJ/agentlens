import type {
  ApiResponse,
  HealthCheckResponse,
  Run,
  CreateRunRequest,
  TelemetryEvent,
  IngestTelemetryRequest,
  TelemetryIngestionResult,
  Incident,
} from '../types/contracts.js';

export class ApiClientError extends Error {
  readonly statusCode?: number;
  readonly code?: string;
  readonly isNetworkError: boolean;

  constructor(
    message: string,
    statusCode?: number,
    code?: string,
    isNetworkError: boolean = false
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.isNetworkError = isNetworkError;
  }
}

class AgentLensApiClient {
  private readonly baseUrl: string;

  constructor() {
    const rawUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
    this.baseUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    let res: Response;

    try {
      res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new ApiClientError(
        `Failed to reach AgentLens backend: ${message}`,
        undefined,
        'NETWORK_ERROR',
        true
      );
    }

    let json: ApiResponse<T> | T;
    try {
      json = await res.json();
    } catch {
      throw new ApiClientError(
        `Invalid response received from server (${res.status})`,
        res.status,
        'INVALID_RESPONSE'
      );
    }

    if (!res.ok) {
      const errorPayload = json as ApiResponse<unknown>;
      const code = errorPayload?.error?.code || `HTTP_${res.status}`;
      const message = errorPayload?.error?.message || `Request failed with status ${res.status}`;
      throw new ApiClientError(message, res.status, code);
    }

    // Unpack ApiResponse<T> if wrapped in { success: true, data: ... }
    if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
      return (json as ApiResponse<T>).data as T;
    }

    return json as T;
  }

  async getHealth(): Promise<HealthCheckResponse> {
    return this.request<HealthCheckResponse>('/health');
  }

  async getRuns(limit?: number): Promise<Run[]> {
    const query = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.request<Run[]>(`/runs${query}`);
  }

  async getRun(run_id: string): Promise<Run> {
    return this.request<Run>(`/runs/${encodeURIComponent(run_id)}`);
  }

  async getRunTelemetry(run_id: string, limit?: number): Promise<TelemetryEvent[]> {
    const query = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.request<TelemetryEvent[]>(`/runs/${encodeURIComponent(run_id)}/telemetry${query}`);
  }

  async createRun(payload: CreateRunRequest): Promise<Run> {
    return this.request<Run>('/runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async ingestTelemetry(run_id: string, payload: IngestTelemetryRequest): Promise<TelemetryIngestionResult> {
    return this.request<TelemetryIngestionResult>(`/runs/${encodeURIComponent(run_id)}/telemetry`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getIncidents(): Promise<Incident[]> {
    return this.request<Incident[]>('/incidents');
  }

  async getIncident(incident_id: string): Promise<Incident> {
    return this.request<Incident>(`/incidents/${encodeURIComponent(incident_id)}`);
  }
}

export const apiClient = new AgentLensApiClient();
