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

## AWS Deployment Setup (Phase 2)

### 1. AWS Credentials Configuration
Configure credentials outside the repository:
```bash
aws configure
# Or export credentials in your shell:
export AWS_ACCESS_KEY_ID="<your-access-key>"
export AWS_SECRET_ACCESS_KEY="<your-secret-key>"
export AWS_REGION="us-east-1"
```

Verify authentication:
```bash
aws sts get-caller-identity
```

### 2. Deploy the Infrastructure Stack
```bash
# Using root npm script
npm run deploy:backend

# Or directly via deploy.sh
AWS_REGION=us-east-1 ENVIRONMENT=dev bash infrastructure/deploy.sh
```

### 3. Verify Deployed Health Endpoint
```bash
curl -i https://<api-id>.execute-api.us-east-1.amazonaws.com/health
```
