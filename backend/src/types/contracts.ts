/**
 * Shared foundation contracts for AgentLens.
 * Defines canonical domain models, API request/response structures, and error contracts.
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  timestamp: string;
  environment: string;
  region?: string;
  table?: string;
}

// ==========================================
// 1. Run Entity
// ==========================================

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Run {
  run_id: string;
  agent_name: string;
  status: RunStatus;
  prompt: string;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateRunRequest {
  agent_name: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

// ==========================================
// 2. Incident Entity
// ==========================================

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';
export type IncidentType =
  | 'tool_loop'
  | 'token_anomaly'
  | 'retrieval_failure'
  | 'wrong_tool'
  | 'runtime_error'
  | string;

export interface Incident {
  incident_id: string;
  run_id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  type: IncidentType;
  summary?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIncidentRequest {
  run_id: string;
  title: string;
  severity: IncidentSeverity;
  type: IncidentType;
  summary?: string;
  status?: IncidentStatus;
}

// ==========================================
// 3. RegressionTest Entity
// ==========================================

export type RegressionTestStatus = 'active' | 'disabled' | 'draft';

export interface RegressionTest {
  test_id: string;
  name: string;
  description?: string;
  incident_id?: string;
  status: RegressionTestStatus;
  created_at: string;
  updated_at: string;
}

// ==========================================
// 4. Evaluation Entity
// ==========================================

export interface Evaluation {
  evaluation_id: string;
  run_id: string;
  metrics: Record<string, number | boolean | string>;
  passed: boolean;
  created_at: string;
}

// ==========================================
// 5. ReplayRecord Entity
// ==========================================

export interface ReplayRecord {
  replay_id: string;
  run_id: string;
  state_snapshot: Record<string, unknown>;
  created_at: string;
}
