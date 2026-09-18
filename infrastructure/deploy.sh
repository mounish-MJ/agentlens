#!/usr/bin/env bash
set -euo pipefail

# 1. Resolve Region (Priority: AWS_REGION env var -> AWS CLI configured region -> default ap-southeast-2)
CLI_REGION=$(aws configure get region 2>/dev/null || true)
REGION="${AWS_REGION:-${CLI_REGION:-ap-southeast-2}}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
STACK_NAME="agentlens-backend-${ENVIRONMENT}-stack"
TEMPLATE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/template.yaml"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../backend" && pwd)"

echo "=== AgentLens AWS Backend Foundation Deployment ==="
echo "Target Region:      ${REGION}"
echo "Environment:        ${ENVIRONMENT}"
echo "Stack Name:         ${STACK_NAME}"
echo "Template File:      ${TEMPLATE_FILE}"
echo "==================================================="

# 2. Check AWS CLI and Validate Authentication via standard credential chain
echo "--> Checking AWS CLI and credentials..."
if ! command -v aws >/dev/null 2>&1; then
  echo "[ERROR] 'aws' CLI is not installed or not in PATH."
  exit 1
fi

# Validate authentication using standard AWS CLI credential provider chain
if ! CALLER_IDENTITY=$(aws sts get-caller-identity --region "${REGION}" --output json 2>&1); then
  echo "[ERROR] AWS authentication failed via AWS CLI credential chain:"
  echo "${CALLER_IDENTITY}"
  echo ""
  echo "Please authenticate using the AWS CLI (e.g., 'aws login' or configure your active profile/role)."
  exit 1
fi

ACCOUNT_ID=$(echo "${CALLER_IDENTITY}" | grep -o '"Account": "[^"]*' | cut -d'"' -f4 || echo "unknown")
ARN=$(echo "${CALLER_IDENTITY}" | grep -o '"Arn": "[^"]*' | cut -d'"' -f4 || echo "unknown")
echo "Authenticated via AWS CLI:"
echo "  Account: ${ACCOUNT_ID}"
echo "  Arn:     ${ARN}"

# 3. Build & Bundle Backend TypeScript
echo "--> Compiling backend TypeScript..."
npm --prefix "${BACKEND_DIR}" run build

echo "--> Bundling Lambda package with esbuild..."
mkdir -p "${BACKEND_DIR}/dist-bundle"
npx -y esbuild "${BACKEND_DIR}/src/handler.ts" \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile="${BACKEND_DIR}/dist-bundle/index.mjs" \
  '--external:@aws-sdk/*'

cp "${BACKEND_DIR}/dist-bundle/index.mjs" "${BACKEND_DIR}/dist-bundle/index.js"
echo '{"type": "module"}' > "${BACKEND_DIR}/dist-bundle/package.json"

(cd "${BACKEND_DIR}/dist-bundle" && zip -q -r "${BACKEND_DIR}/lambda.zip" index.js index.mjs package.json)
echo "--> Lambda package created (${BACKEND_DIR}/lambda.zip)"

# 4. Deploy CloudFormation Stack (Maintains existing resources)
echo "--> Deploying CloudFormation stack: ${STACK_NAME}..."
if ! aws cloudformation deploy \
  --template-file "${TEMPLATE_FILE}" \
  --stack-name "${STACK_NAME}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Environment="${ENVIRONMENT}" TableName="agentlens-data" \
  --region "${REGION}" \
  --no-fail-on-empty-changeset; then
  echo ""
  echo "[ERROR] CloudFormation deployment failed."
  echo "Please review the AWS error message above to identify the failing resource or permission constraint."
  exit 1
fi

echo "--> CloudFormation stack ready!"

# 5. Update Lambda Function Code with real Application API
LAMBDA_FUNCTION_NAME="agentlens-backend-${ENVIRONMENT}"
echo "--> Deploying Application API code to Lambda (${LAMBDA_FUNCTION_NAME})..."
aws lambda update-function-code \
  --function-name "${LAMBDA_FUNCTION_NAME}" \
  --zip-file "fileb://${BACKEND_DIR}/lambda.zip" \
  --region "${REGION}" >/dev/null

echo "--> Waiting for Lambda function update to settle..."
aws lambda wait function-updated \
  --function-name "${LAMBDA_FUNCTION_NAME}" \
  --region "${REGION}"
echo "--> Lambda code successfully updated!"

# 6. Extract Stack Outputs
echo "--> Retrieving stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs' \
  --output json)

API_ENDPOINT=$(echo "${OUTPUTS}" | grep -A 2 '"OutputKey": "ApiEndpoint"' | grep '"OutputValue"' | cut -d'"' -f4 || true)
HEALTH_URL=$(echo "${OUTPUTS}" | grep -A 2 '"OutputKey": "HealthEndpoint"' | grep '"OutputValue"' | cut -d'"' -f4 || true)
TABLE_NAME=$(echo "${OUTPUTS}" | grep -A 2 '"OutputKey": "DynamoDBTableName"' | grep '"OutputValue"' | cut -d'"' -f4 || true)

echo "==================================================="
echo "API Endpoint:        ${API_ENDPOINT}"
echo "Health Endpoint:     ${HEALTH_URL}"
echo "DynamoDB Table:      ${TABLE_NAME}"
echo "==================================================="

# 7. Real Persistence Smoke Test
if [ -n "${API_ENDPOINT}" ]; then
  echo ""
  echo "=== REAL PERSISTENCE SMOKE TEST ==="
  
  echo "1. Testing GET /health..."
  curl -s -i "${API_ENDPOINT}/health"
  echo ""

  echo "2. Testing POST /runs (Real DynamoDB Persistence)..."
  CREATE_RES=$(curl -s -X POST "${API_ENDPOINT}/runs" \
    -H "Content-Type: application/json" \
    -d '{"agent_name": "smoke-test-agent", "prompt": "Verify DynamoDB Phase 3 persistence"}')
  echo "POST /runs Response: ${CREATE_RES}"

  RUN_ID=$(echo "${CREATE_RES}" | grep -o '"run_id":"[^"]*' | cut -d'"' -f4 || true)

  if [ -n "${RUN_ID}" ]; then
    echo "Created Run ID: ${RUN_ID}"
    echo "3. Testing GET /runs/${RUN_ID} (Confirming DynamoDB persistence)..."
    GET_RUN_RES=$(curl -s "${API_ENDPOINT}/runs/${RUN_ID}")
    echo "GET /runs/${RUN_ID} Response: ${GET_RUN_RES}"

    echo "4. Cleaning up smoke test run item from DynamoDB..."
    aws dynamodb delete-item \
      --table-name "${TABLE_NAME}" \
      --key '{"pk": {"S": "RUN#'"${RUN_ID}"'"}, "sk": {"S": "METADATA"}}' \
      --region "${REGION}" >/dev/null || true
    echo "Cleanup complete."
  else
    echo "[WARNING] Could not parse run_id from POST /runs response"
  fi

  echo "5. Testing GET /incidents (Verifying real data / empty collection, no fake data)..."
  INCIDENTS_RES=$(curl -s "${API_ENDPOINT}/incidents")
  echo "GET /incidents Response: ${INCIDENTS_RES}"
fi

# 8. Verify DynamoDB Table Status
if [ -n "${TABLE_NAME}" ]; then
  echo ""
  echo "--> Verifying DynamoDB table status..."
  aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" --query 'Table.TableStatus' --output text || true
fi

echo "=== Deployment and Verification Complete! ==="
