# AgentLens Architecture Overview

## Member 4 Platform / UI Scope (Project Blank Slate — ap-southeast-2)
AgentLens Platform/UI is structured as a modern serverless web application designed for fast iteration, high availability, and secure cloud operations in **ap-southeast-2** (Account: 272175292167).

### High-Level Architecture Flow

```
Agent Execution (Member 1)
       │
       ▼ (Telemetry Events & Metrics via HTTP API)
[ AWS API Gateway HTTP API (agentlens-api-dev) ]
       │
       ▼ (AWS_PROXY v2 integration)
[ AWS Lambda Backend (agentlens-backend-dev) ] ──► [ CloudWatch Logs (/aws/lambda/agentlens-backend-dev) ]
       │
       ▼ (TelemetryService Ingestion & Validation Layer)
[ AgentLens Repository Layer ]
       │
       ▼ (IAM Least-Privilege Role: agentlens-lambda-role-dev)
[ Amazon DynamoDB (agentlens-data-dev) ]
       │
       ▲
[ React UI Dashboard (Amplify) ] (Member 4)
```

---

## Team Member Ownership Matrix

| Member | Focus Area | Responsibilities | Ingestion Boundary |
|---|---|---|---|
| **Member 1** | Agent Execution | Agent prompt loops, LLM calls, tool invocation execution | Emits telemetry via `POST /runs/{run_id}/telemetry` |
| **Member 2** | Detection & Anomaly | Tool-loop, token anomaly, retrieval failure, and wrong-tool detectors | Consumes telemetry & runs; generates `Incident` entities |
| **Member 3** | Analysis & Evaluation | Bedrock RCA, chaos generation, replay engine, regression tests | Evaluates runs, creates `Evaluation` & `ReplayRecord` entities |
| **Member 4** | Platform, Persistence & UI (THIS WORKSPACE) | AWS serverless foundation, API Gateway, Lambda, DynamoDB persistence, Telemetry Ingestion boundary, and React UI | Exposes `POST /runs/{run_id}/telemetry` and provides persistent queries |

---

## Phase 4: Platform Integration & Telemetry Persistence

### 1. Ingestion Boundary & Telemetry Contract
Incoming telemetry records real execution observability from agent workflows into DynamoDB:
- **Canonical Event Types**: Strictly validated to `tool_call`, `model_invocation`, `state_change`, `log`, `metric`. Unknown types are rejected with HTTP 400 (`VALIDATION_ERROR`).
- **Generated Event IDs**: Each event receives a unique identifier (`evt_<uuid>`) to guarantee collision-free writes across concurrent agent execution workers.
- **Bounded Run Updates**: Ingestion updates `status`, `result`, `error`, `metrics`, and increments `events_count`. It **never** fabricates incidents or domain algorithm findings (Member 4 boundary).

### 2. DynamoDB Single-Table Key Strategy

- **Table**: `agentlens-data-{env}`
- **Partition Key (`pk`)**: String
- **Sort Key (`sk`)**: String
- **Capacity**: `PAY_PER_REQUEST` (On-Demand)

#### Key Mappings:
| Entity | Partition Key (`pk`) | Sort Key (`sk`) | Access Pattern |
|---|---|---|---|
| `Run (Metadata)` | `RUN#<run_id>` | `METADATA` | `GetItem(pk=RUN#<id>, sk=METADATA)` (O(1)) |
| `Run Telemetry Events` | `RUN#<run_id>` | `EVENT#<timestamp>#<event_id>` | `Query(pk=RUN#<id>, begins_with(sk, 'EVENT#'))` (O(k)) |
| `Incident (Primary)` | `INCIDENT#<incident_id>` | `METADATA` | `GetItem(pk=INCIDENT#<id>, sk=METADATA)` (O(1)) |
| `Incidents (Timeline)` | `INCIDENTS` | `INCIDENT#<created_at>#<id>` | `Query(pk=INCIDENTS, ScanIndexForward=false)` (O(k)) |
| `RegressionTest` | `TEST#<test_id>` | `METADATA` | `GetItem(pk=TEST#<id>, sk=METADATA)` (O(1)) |
| `Evaluation` | `EVAL#<evaluation_id>` | `METADATA` | `GetItem(pk=EVAL#<id>, sk=METADATA)` (O(1)) |
| `ReplayRecord` | `REPLAY#<replay_id>` | `METADATA` | `GetItem(pk=REPLAY#<id>, sk=METADATA)` (O(1)) |

### 3. Implemented API Endpoints

- `GET /health` — Foundation health probe returning runtime status, region, and table name.
- `POST /runs` — Validate and create agent run with generated `run_id`.
- `GET /runs/{run_id}` — Point lookup of run by ID (returns status, metrics, and `events_count`).
- `POST /runs/{run_id}/telemetry` — Ingest telemetry events, execution metrics, and update Run status.
- `GET /runs/{run_id}/telemetry` — Retrieve chronological telemetry events for a Run (oldest to newest).
- `GET /incidents` — Query chronological incidents without table scan (returns empty collection if none).
- `GET /incidents/{incident_id}` — Point lookup of incident by ID.

---

### Key Principles
1. **Separation of Concerns**: HTTP controllers serialize/deserialize; `TelemetryService` validates and normalizes; `AgentLensRepository` executes DynamoDB commands.
2. **Environment Portability**: Local execution via lightweight development server (`http://localhost:4000`); cloud execution via AWS Lambda without rewriting core handler logic.
3. **Strict Zero-Secret Policy**: No AWS keys, session tokens, or private secrets in source control.
