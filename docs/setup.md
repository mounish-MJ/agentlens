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

### 3. Verify Deployed Application API (Phase 3)
```bash
# 1. Health Probe
curl -i https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/health

# 2. Create Run
curl -i -X POST https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/runs \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "demo-agent", "prompt": "Analyze security logs"}'

# 3. Get Run by ID
curl -i https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/runs/<run_id>

# 4. List Incidents (returns empty array when none exist)
curl -i https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/incidents

# 5. Get Incident by ID
curl -i https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/incidents/<incident_id>
```
