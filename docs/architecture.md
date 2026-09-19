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
       ▼ (TelemetryService & Controller Layer)
[ AgentLens Repository Layer ]
       │
       ▼ (IAM Least-Privilege Role: agentlens-lambda-role-dev)
[ Amazon DynamoDB (agentlens-data-dev) ]
       │
       ▲ (Real Data REST API Client)
[ React UI Dashboard (AWS Amplify Hosted) ] (Member 4)
```

---

## Team Member Ownership Matrix

| Member | Focus Area | Responsibilities | Ingestion Boundary |
|---|---|---|---|
| **Member 1** | Agent Execution | Agent prompt loops, LLM calls, tool invocation execution | Emits telemetry via `POST /runs/{run_id}/telemetry` |
| **Member 2** | Detection & Anomaly | Tool-loop, token anomaly, retrieval failure, and wrong-tool detectors | Consumes telemetry & runs; generates `Incident` entities |
| **Member 3** | Analysis & Evaluation | Bedrock RCA, chaos generation, replay engine, regression tests | Evaluates runs, creates `Evaluation` & `ReplayRecord` entities |
| **Member 4** | Platform, Persistence & UI (THIS WORKSPACE) | AWS serverless foundation, API Gateway, Lambda, DynamoDB persistence, Telemetry Ingestion, GET /runs, React UI & Amplify | Exposes full API (`/runs`, `/telemetry`, `/incidents`) & web dashboard |

---

## Phase 6: Incident & Diagnosis Platform Foundation

### 1. Architectural Scope & Boundary
Phase 6 establishes the persistence and API boundary for real reliability incidents, observable execution evidence, and root cause analysis (RCA):
- **Member 4 Ownership**: Platform boundary, DynamoDB persistence, API endpoints, observable evidence presentation, bidirectional investigation UI, and RCA request boundary.
- **Member 2 Ownership**: Deterministic detectors (tool-loop, token anomaly, retrieval failure, wrong-tool), detector scoring, detector correlation, incident-generation semantics, and Bedrock RCA reasoning.
- **Strict Separation of Evidence vs Interpretation**: Execution evidence (tool name, event ID, latency, raw parameters) is stored and presented separately from subjective or LLM-generated root cause analysis.

### 2. DynamoDB Single-Table Key Strategy (Zero Scans, Zero GSIs)

- **Table**: `agentlens-data-{env}`
- **Capacity**: `PAY_PER_REQUEST` (On-Demand)
- **Zero Scan Guarantee**: All application queries are bounded `QueryCommand` or `GetCommand` calls targeting known partition keys.

#### Key Mappings Matrix:
| Entity / Pattern | Partition Key (`pk`) | Sort Key (`sk`) | Description | Query Access Pattern |
|---|---|---|---|---|
| `Run (Metadata)` | `RUN#<run_id>` | `METADATA` | Primary execution record | `GetItem(pk=RUN#<id>, sk=METADATA)` (O(1)) |
| `Runs (Timeline)` | `RUNS` | `RUN#<created_at>#<run_id>` | Chronological runs index | `Query(pk=RUNS, ScanIndexForward=false)` (O(k)) |
| `Run Telemetry Events` | `RUN#<run_id>` | `EVENT#<timestamp>#<event_id>` | Trace events collection | `Query(pk=RUN#<id>, begins_with(sk, 'EVENT#'))` (O(k)) |
| `Incident (Primary Rep 1)` | `INCIDENT#<incident_id>` | `METADATA` | Direct incident lookup | `GetItem(pk=INCIDENT#<id>, sk=METADATA)` (O(1)) |
| `Incident (Global Rep 2)` | `INCIDENTS` | `INCIDENT#<created_at>#<id>` | Chronological incident index | `Query(pk=INCIDENTS, ScanIndexForward=false)` (O(k)) |
| `Incident (Run Assoc Rep 3)` | `RUN#<run_id>` | `INCIDENT#<created_at>#<id>` | Run-associated incidents | `Query(pk=RUN#<run_id>, begins_with(sk, 'INCIDENT#'))` (O(k)) |

#### Atomic Multi-Item Transactions:
- **`createIncident`**: Uses `TransactWriteCommand` to commit all 3 representations simultaneously. If any representation fails, none are committed.
- **`updateIncidentRca`**: Uses `TransactWriteCommand` to update all 3 representations with `rca`, `status`, and `updated_at` without losing existing fields.

### 3. Implemented API Endpoints (Phase 3–6)

- `GET /health` — Foundation health probe returning runtime status, region, and table name.
- `POST /runs` — Validate and create agent run with generated `run_id`. Atomically writes primary and timeline items.
- `GET /runs?limit={n}` — List chronological agent runs (newest first) using `Query(pk=RUNS)` without table scan.
- `GET /runs/{run_id}` — Point lookup of run by ID (returns status, metrics, and `events_count`).
- `POST /runs/{run_id}/telemetry` — Ingest telemetry events, execution metrics, and update Run status across both items.
- `GET /runs/{run_id}/telemetry` — Retrieve chronological telemetry events for a Run (oldest to newest).
- `GET /incidents?limit={n}&run_id={id}` — List chronological incidents, optionally filtered by Run (zero scan).
- `POST /incidents` — Validate and persist canonical incident into 3 representations atomically.
- `GET /incidents/{incident_id}` — Point lookup of incident by ID.
- `POST /incidents/{incident_id}/rca` — Persist structured RCA payload (Case A) or return HTTP 501 `RCA_SERVICE_NOT_INTEGRATED` on automated trigger (Case B).
- `GET /runs/{run_id}/incidents` — Retrieve all incidents associated with a Run via `begins_with(sk, 'INCIDENT#')`.

---

### 4. AWS Amplify Build Configuration
The React application is prepared for deployment via AWS Amplify using `amplify.yml`:
- Monorepo build step: `npm --prefix frontend ci && npm --prefix frontend run build`
- Target artifact directory: `frontend/dist`
- Environment variable: `VITE_API_BASE_URL` points to the deployed API Gateway endpoint.
