# AgentLens Architecture Overview

## Member 4 Platform / UI Scope (Project Blank Slate — ap-southeast-2)
AgentLens Platform/UI is structured as a modern serverless web application designed for fast iteration, high availability, and secure cloud operations in **ap-southeast-2** (Account: 272175292167).

### High-Level Architecture Flow

```
[ React UI (Amplify) ] 
       │
       ▼ (HTTPS / CORS)
[ AWS API Gateway HTTP API (agentlens-api-dev) ]
       │
       ▼ (AWS_PROXY v2 integration)
[ AWS Lambda Backend (agentlens-backend-dev) ] ──► [ CloudWatch Logs (/aws/lambda/agentlens-backend-dev) ]
       │
       ▼ (IAM Least-Privilege Role: agentlens-lambda-role-dev)
[ Amazon DynamoDB (agentlens-data-dev) ]
```

---

## Phase 3: Application API & Persistence Architecture

### 1. Canonical Domain Entities
- **Run**: Execution trace lifecycle of an AI agent, prompts, status, and execution metadata.
- **Incident**: Detected anomalies, execution failures, tool loops, or errors.
- **RegressionTest**: Test suites derived from workflows/incidents for quality regression.
- **Evaluation**: Scorecard evaluation results assessing agent metrics.
- **ReplayRecord**: Environment state snapshots for deterministic trace replay.

### 2. DynamoDB Single-Table Key Strategy
- **Table**: `agentlens-data-{env}`
- **Partition Key (`pk`)**: String
- **Sort Key (`sk`)**: String
- **Capacity**: `PAY_PER_REQUEST` (On-Demand)

#### Key Mappings:
| Entity | Partition Key (`pk`) | Sort Key (`sk`) | Access Pattern |
|---|---|---|---|
| `Run` | `RUN#<run_id>` | `METADATA` | `GetItem(pk=RUN#<id>, sk=METADATA)` (O(1)) |
| `Incident` | `INCIDENT#<incident_id>` | `METADATA` | `GetItem(pk=INCIDENT#<id>, sk=METADATA)` (O(1)) |
| `Incidents (Timeline)` | `INCIDENTS` | `INCIDENT#<created_at>#<id>` | `Query(pk=INCIDENTS, ScanIndexForward=false)` (O(k)) |
| `RegressionTest` | `TEST#<test_id>` | `METADATA` | `GetItem(pk=TEST#<id>, sk=METADATA)` (O(1)) |
| `Evaluation` | `EVAL#<evaluation_id>` | `METADATA` | `GetItem(pk=EVAL#<id>, sk=METADATA)` (O(1)) |
| `ReplayRecord` | `REPLAY#<replay_id>` | `METADATA` | `GetItem(pk=REPLAY#<id>, sk=METADATA)` (O(1)) |

### 3. Implemented API Endpoints
- `GET /health`: Health probe returning status, region, and table name.
- `POST /runs`: Validate and create agent run with generated `run_id`.
- `GET /runs/{run_id}`: Point lookup of run by ID.
- `GET /incidents`: Query chronological incidents without table scan (returns empty collection if none).
- `GET /incidents/{incident_id}`: Point lookup of incident by ID.

---

### Key Principles
1. **Separation of Concerns**: Frontend UI components, backend Lambda handlers, repository layer, and shared contracts remain decoupled.
2. **Environment Portability**: Local execution via lightweight development server (`http://localhost:4000`); cloud execution via AWS Lambda without rewriting core handler logic.
3. **Strict Zero-Secret Policy**: No AWS keys, session tokens, or private secrets in source control.
