# AgentLens

> Platform and UI Foundation for AgentLens — AWS Serverless Architecture & React Frontend.

## Project Structure

```
agentlens/
├── backend/            # Express local dev server & AWS Lambda handlers (TypeScript)
├── frontend/           # React + TypeScript single page application (Vite)
├── infrastructure/     # AWS CloudFormation template & deployment scripts
├── contracts/          # Shared TypeScript interfaces & API response contracts
├── tests/              # Smoke & foundation tests (node:test)
├── docs/               # Architecture overviews & setup guides
├── package.json        # Root monorepo orchestration scripts
└── .gitignore          # Comprehensive secrets & build artifact exclusion
```

---

## AWS Architecture Foundation (Phase 2 & Phase 3)

```
[ Future React Frontend / Amplify / Localhost ]
                      │ (HTTPS / CORS)
                      ▼
        [ AWS API Gateway HTTP API ]
           (agentlens-api-dev)
                      │
               (AWS_PROXY v2)
                      ▼
         [ AWS Lambda Function ]  ──►  [ Amazon CloudWatch Logs ]
        (agentlens-backend-dev)         (/aws/lambda/agentlens-backend-dev)
                      │
               (IAM Least-Privilege)
                      ▼
          [ Amazon DynamoDB ]
         (agentlens-data-dev)
```

- **API Gateway (HTTP API v2)**: Exposes application endpoints with full CORS support (`*`) and routes requests to the Lambda function.
- **AWS Lambda**: Decoupled entry point (`backend/src/handler.ts`) executing Phase 3 API handlers with CloudWatch logging.
- **Amazon DynamoDB**: Single-table persistence (`agentlens-data-dev`) implementing deterministic `pk`/`sk` patterns for all canonical entities without scans or secondary indexes.
- **IAM**: Least-privilege role restricted strictly to CloudWatch log creation and DynamoDB operations on the application table.

### Implemented Endpoints (Phase 3, Phase 4, Phase 5 & Phase 6)
- `GET /health` — Runtime health check probe
- `POST /runs` — Validate and create agent run in DynamoDB (writes primary & timeline items atomically)
- `GET /runs?limit={n}` — List chronological agent runs (newest first, zero table scan)
- `GET /runs/{run_id}` — Get Run by ID (includes status, execution metrics, and events count)
- `POST /runs/{run_id}/telemetry` — Ingest telemetry events (tool calls, model invocations, logs, metrics) and update Run status
- `GET /runs/{run_id}/telemetry` — Retrieve chronological execution telemetry events for a Run
- `GET /incidents` — List chronological incidents (supports optional `run_id` filter and bounded limit)
- `POST /incidents` — Validate and persist canonical incident (atomically writes all 3 representations)
- `GET /incidents/{incident_id}` — Get Incident by ID
- `POST /incidents/{incident_id}/rca` — RCA integration boundary: persists structured RCA payload, or returns HTTP 501 `RCA_SERVICE_NOT_INTEGRATED` on automated trigger
- `GET /runs/{run_id}/incidents` — List all incidents associated with a specific agent Run (zero table scan)

---

## AgentLens UI & Incident Investigation (Phase 6)

The React web application provides an enterprise-grade observability and diagnosis platform connected directly to the serverless backend:
- **Overview**: High-level execution stats (total runs, completed, active), incident counts, recent runs, and honest empty states ("Zero Incidents Detected").
- **Runs List**: Filterable and searchable table of all persisted agent executions with token metrics and event counts.
- **Run Detail (`#runs/:run_id`)**: Detailed execution view with token usage cards, duration metrics, tool call counts, full chronological telemetry timeline with expandable JSON payloads, and an **Associated Incidents** panel with deep click-through.
- **Incidents View (`#incidents` / `#incidents/:incident_id`)**:
  - Filter by severity (`critical`, `high`, `medium`, `low`), status (`open`, `investigating`, `resolved`), or search query.
  - Deep-linkable Incident Detail view showing:
    1. Incident summary & classification
    2. Associated Run banner with bidirectional link to Run Detail
    3. **Observed Execution Evidence**: Distinct section presenting verified telemetry events, metrics, tool names, and expandable raw payloads without synthetic interpretations.
    4. **Root Cause Analysis (RCA)**: Explicit structured RCA findings when supplied, or an honest `"RCA Not Available"` banner.
  - **No Fake Data Guarantee**: Zero synthetic incidents, fake metrics, or fabricated Bedrock explanations. When 0 incidents exist, displays "Zero Incidents Detected".
- **Bidirectional Navigation**: Fluid cross-linking: Runs → Run Detail → Associated Incident → Incident Detail → Associated Run.
- **Amplify Ready**: Includes `amplify.yml` for automated CI/CD frontend deployment on AWS Amplify.

---

## Platform Ownership Boundary (Member 4 vs Member 2)

- **Member 4 (THIS REPOSITORY)**: Owns platform foundation, single-table DynamoDB persistence, API endpoints, incident data contracts, observable evidence presentation, bidirectional investigation UI, and the RCA request/persistence boundary.
- **Member 2**: Owns deterministic detectors (tool-loop, token anomaly, retrieval failure, wrong-tool), detector scoring and correlation, incident-generation semantics, and Bedrock RCA reasoning.
- **Boundary Contract**: When an automated RCA request is received (`trigger_automated_rca: true` or empty payload), Member 4 returns HTTP 501 (`RCA_SERVICE_NOT_INTEGRATED`). No fake RCA or simulated Bedrock analysis is ever generated.

---

## Quick Start (Local Development)

### Prerequisites
- **Node.js**: v20+ (v24+ tested)
- **npm**: v10+
- **AWS CLI**: v2+ (for AWS deployments)

### 1. Install Dependencies
```bash
# Backend dependencies
cd backend && npm install && cd ..

# Frontend dependencies
cd frontend && npm install && cd ..
```

---

### 2. Environment Configuration

Environment variables are separated from source code using `.env.example` templates.

```bash
# Backend environment setup
cp backend/.env.example backend/.env

# Frontend environment setup
cp frontend/.env.example frontend/.env
```

#### Backend Environment Variables (`backend/.env.example`)
| Variable | Description | Default |
|---|---|---|
| `PORT` | Local HTTP server port | `4000` |
| `NODE_ENV` | Environment identifier | `development` |
| `AWS_REGION` | Target AWS Region (Project Blank Slate) | `ap-southeast-2` |
| `DYNAMODB_TABLE_NAME` | DynamoDB table name | `agentlens-data-dev` |

#### Frontend Environment Variables (`frontend/.env.example`)
| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Base URL for API Gateway or local backend | `http://localhost:4000` |

> **Security Note**: No secrets, credentials, or private keys are stored in the repository.

---

### 3. Running Locally

#### Start Backend
```bash
npm run dev:backend
# or: cd backend && npm run dev
```
- Local server: `http://localhost:4000`
- Health check: `http://localhost:4000/health`

#### Start Frontend
```bash
npm run dev:frontend
# or: cd frontend && npm run dev
```
- Local dev server: `http://localhost:5173`

---

### 4. Running Tests & Builds

```bash
# Run foundation smoke test suite
npm test

# Run backend unit tests
npm --prefix backend test

# Run frontend linter
npm --prefix frontend run lint

# Build both applications
npm run build
```

---

### 5. Deploying to AWS (Phase 2 — Project Blank Slate)

```bash
# Deploy to AWS ap-southeast-2 (Project Blank Slate default)
npm run deploy:backend
```