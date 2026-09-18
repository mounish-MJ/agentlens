# AgentLens Architecture Overview

## Member 4 Platform / UI Scope
AgentLens Platform/UI is structured as a modern serverless web application designed for fast iteration, high availability, and secure cloud operations.

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

### Components Implemented (Phase 2)
1. **API Gateway (HTTP API v2)**: Routes `GET /health` and `$default` to the Lambda backend with CORS enabled for all origins.
2. **Lambda Handler**: TypeScript handler running on `nodejs20.x`, with decoupled local development wrapper (`server.ts`) and CloudWatch logging.
3. **DynamoDB**: Single-table design (`pk`, `sk`) with On-Demand (pay-per-request) billing mode and point-in-time recovery.
4. **IAM Role**: Scoped strictly to CloudWatch log creation/writing and DynamoDB operations on the `agentlens-data-*` table.
5. **CloudWatch Logs**: Dedicated log group with 14-day retention.

### Key Principles
1. **Separation of Concerns**: Frontend UI components, backend Lambda handlers, and shared contracts remain decoupled.
2. **Environment Portability**: Local execution via lightweight development server (`http://localhost:4000`); cloud execution via AWS Lambda without rewriting core handler logic.
3. **Strict Zero-Secret Policy**: No AWS keys, session tokens, or private secrets in source control.
