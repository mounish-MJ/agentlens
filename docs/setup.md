# Local Development & AWS Deployment Guide

## Prerequisites
- Node.js (v20+ recommended, v24+ supported)
- npm (v10+)
- AWS CLI (v2+, optional for local execution; required for AWS deployment)

---

## Local Development Setup

### 1. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
The backend server runs locally at `http://localhost:4000`. Test via:
```bash
curl http://localhost:4000/health
```

### 2. Frontend Setup
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```
The frontend dev server will launch at `http://localhost:5173`.

### 3. Running Verification Tests
```bash
npm test
npm --prefix backend test
npm --prefix frontend run lint
npm run build
```

---

## AWS Deployment Setup (Phase 2 — Project Blank Slate)

### 1. AWS Credentials Configuration
Authenticate via standard AWS CLI:
```bash
aws login
# Or configure default region:
aws configure set region ap-southeast-2
```

Verify authentication and target region:
```bash
aws sts get-caller-identity
# Target region: ap-southeast-2 (Project Blank Slate)
```

### 2. Deploy the Infrastructure Stack
```bash
# Using root npm script (defaults to ap-southeast-2)
npm run deploy:backend

# Or directly via deploy.sh
AWS_REGION=ap-southeast-2 ENVIRONMENT=dev bash infrastructure/deploy.sh
```

### 3. Verify Deployed Application API (Phase 3–6)
```bash
# 1. Health Probe
curl -i https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/health

# 2. Create Run (writes primary and timeline items atomically)
curl -i -X POST https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/runs \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "demo-agent", "prompt": "Analyze security logs"}'

# 3. Create Incident linked to Run (atomically creates 3 DynamoDB representations)
curl -i -X POST https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/incidents \
  -H "Content-Type: application/json" \
  -d '{
    "run_id": "<run_id>",
    "title": "Tool loop failure",
    "type": "tool_loop",
    "severity": "high",
    "detector_source": "tool_loop_detector",
    "confidence": 0.96,
    "evidence": [{"event_id": "evt_1", "type": "tool_call", "name": "search", "metric": "retries", "value": 4}]
  }'

# 4. List Incidents (supports optional ?run_id=<run_id> filter)
curl -i "https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/incidents"

# 5. Get Incident by ID
curl -i https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/incidents/<incident_id>

# 6. List Incidents by Run (zero table scan)
curl -i https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/runs/<run_id>/incidents

# 7. Persist Structured RCA Payload (Case A)
curl -i -X POST https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/incidents/<incident_id>/rca \
  -H "Content-Type: application/json" \
  -d '{
    "rca": {
      "primary_failure": "Search timeout",
      "root_cause": "Rate limit exceeded on external API",
      "analyzed_at": "2026-09-19T04:00:00.000Z"
    },
    "status": "resolved"
  }'

# 8. Test Automated RCA Request Boundary (Case B -> HTTP 501 RCA_SERVICE_NOT_INTEGRATED)
curl -i -X POST https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/incidents/<incident_id>/rca \
  -H "Content-Type: application/json" \
  -d '{"trigger_automated_rca": true}'
```

---

## AWS Amplify Frontend Deployment (Phase 5)

The frontend is prepared for continuous deployment via AWS Amplify:

1. **Build Specification (`amplify.yml`)**:
   - `preBuild`: runs `npm --prefix frontend ci` using `frontend/package-lock.json`
   - `build`: runs `npm --prefix frontend run build` (`tsc -b && vite build`)
   - `baseDirectory`: `frontend/dist`
2. **Environment Variable Configuration**:
   - In AWS Amplify Console, set `VITE_API_BASE_URL` to your deployed API Gateway endpoint (e.g., `https://<api-id>.execute-api.ap-southeast-2.amazonaws.com`).
   - No AWS credentials or secrets are stored in the frontend or Amplify configuration.
