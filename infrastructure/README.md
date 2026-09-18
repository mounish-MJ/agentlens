# AWS Infrastructure — AgentLens Backend Foundation

This directory contains the reproducible AWS infrastructure definition for the AgentLens backend foundation using AWS CloudFormation.

## Architecture

```
[ Future React Frontend / Amplify / Localhost ]
                      │ (HTTPS / CORS)
                      ▼
        [ AWS API Gateway HTTP API ]
           (agentlens-api-{env})
                      │
               (AWS_PROXY v2)
                      ▼
         [ AWS Lambda Function ]  ──►  [ Amazon CloudWatch Logs ]
        (agentlens-backend-{env})       (/aws/lambda/agentlens-backend-{env})
                      │
               (IAM Least-Privilege)
                      ▼
          [ Amazon DynamoDB ]
         (agentlens-data-{env})
```

---

## Resources Defined in `template.yaml`

1. **Amazon API Gateway HTTP API (`agentlens-api-{env}`)**
   - Protocol: HTTP API (v2)
   - CORS enabled for all origins (`*`) and standard headers/methods (`GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`).
   - Routes: `GET /health` and `$default` integration to the Lambda backend.
   - Stage: `$default` with AutoDeploy enabled.

2. **AWS Lambda Function (`agentlens-backend-{env}`)**
   - Runtime: `nodejs20.x`
   - Memory: 256 MB, Timeout: 10s
   - Environment variables: `NODE_ENV`, `DYNAMODB_TABLE_NAME`.
   - Entry point: `backend/src/handler.ts` (compiled to `dist/handler.js`).
   - Emits structured invocation logs to CloudWatch.

3. **Amazon DynamoDB (`agentlens-data-{env}`)**
   - Single-table design foundation:
     - Partition Key: `pk` (String)
     - Sort Key: `sk` (String)
   - Billing Mode: `PAY_PER_REQUEST` (On-Demand capacity)
   - Point-In-Time Recovery: Enabled

4. **IAM Role (`agentlens-lambda-role-{env}`)**
   - Least privilege execution role:
     - `AWSLambdaBasicExecutionRole` (CloudWatch Logs creation and writing)
     - Inline policy `AgentLensDynamoDBAccess` scoped strictly to the table ARN and indexes.
   - Zero hardcoded credentials; no administrator permissions granted.

5. **CloudWatch Log Group (`/aws/lambda/agentlens-backend-{env}`)**
   - Retention: 14 days

---

## Deployment Instructions

### Prerequisites
- AWS CLI v2 installed
- Valid AWS credentials configured (`aws configure` or environment variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)

### Deploying the Stack
Run the deployment script or npm command:

```bash
# Using npm
npm run deploy:backend

# Or directly via script
AWS_REGION=us-east-1 ENVIRONMENT=dev bash infrastructure/deploy.sh
```

Or deploy directly via AWS CloudFormation CLI:
```bash
aws cloudformation deploy \
  --template-file infrastructure/template.yaml \
  --stack-name agentlens-backend-dev-stack \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Environment=dev TableName=agentlens-data \
  --region us-east-1
```

---

## Verifying Deployed Resources

1. **Test Health Endpoint:**
   ```bash
   curl -i https://<api-id>.execute-api.us-east-1.amazonaws.com/health
   ```
   Expected response: HTTP 200 with JSON payload `{"status":"ok","service":"agentlens-backend",...}`

2. **Verify DynamoDB Table:**
   ```bash
   aws dynamodb describe-table --table-name agentlens-data-dev --region us-east-1
   ```

3. **Inspect CloudWatch Logs:**
   ```bash
   aws logs tail /aws/lambda/agentlens-backend-dev --follow --region us-east-1
   ```
