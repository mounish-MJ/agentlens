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

### Implemented Endpoints (Phase 3 & Phase 4)
- `GET /health` — Runtime health check probe
- `POST /runs` — Validate and create agent run in DynamoDB
- `GET /runs/{run_id}` — Get Run by ID (includes status, execution metrics, and events count)
- `POST /runs/{run_id}/telemetry` — Ingest telemetry events (tool calls, model invocations, logs, metrics) and update Run status
- `GET /runs/{run_id}/telemetry` — Retrieve chronological execution telemetry events for a Run
- `GET /incidents` — List chronological incidents (empty collection when none exist)
- `GET /incidents/{incident_id}` — Get Incident by ID

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