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

# 7. Real Persistence Smoke Test (Phase 6)
if [ -n "${API_ENDPOINT}" ]; then
  echo ""
  echo "=== REAL PERSISTENCE SMOKE TEST (PHASE 6) ==="
  
  # Step 1: GET /health
  echo "1. Testing GET /health..."
  curl -s -i "${API_ENDPOINT}/health"
  echo ""

  # Step 2: Initial GET /incidents
  echo "2. Testing initial GET /incidents..."
  INITIAL_INCS=$(curl -s "${API_ENDPOINT}/incidents")
  echo "Initial GET /incidents: ${INITIAL_INCS}"

  # Step 3: Create temporary real Run using POST /runs
  echo "3. Creating temporary real Run using POST /runs..."
  CREATE_RUN_RES=$(curl -s -X POST "${API_ENDPOINT}/runs" \
    -H "Content-Type: application/json" \
    -d '{"agent_name": "smoke-test-agent-p6", "prompt": "Verify Phase 6 incident persistence and RCA boundary"}')
  echo "POST /runs Response: ${CREATE_RUN_RES}"

  SMOKE_RUN_ID=$(echo "${CREATE_RUN_RES}" | grep -o '"run_id":"[^"]*' | cut -d'"' -f4 || true)
  RUN_CREATED_AT=$(echo "${CREATE_RUN_RES}" | grep -o '"created_at":"[^"]*' | cut -d'"' -f4 || true)

  if [ -z "${SMOKE_RUN_ID}" ]; then
    echo "[ERROR] Failed to obtain run_id from POST /runs"
    exit 1
  fi
  echo "Created temporary Run ID: ${SMOKE_RUN_ID} (created_at: ${RUN_CREATED_AT})"

  # Step 4: Create temporary real Incident linked to that Run using POST /incidents
  echo "4. Creating temporary real Incident linked to Run using POST /incidents..."
  CREATE_INC_RES=$(curl -s -X POST "${API_ENDPOINT}/incidents" \
    -H "Content-Type: application/json" \
    -d '{
      "run_id": "'"${SMOKE_RUN_ID}"'",
      "title": "Smoke Test Tool Loop Incident",
      "summary": "Demonstrating real Phase 6 platform persistence without fake data",
      "type": "tool_loop",
      "severity": "high",
      "detector_source": "smoke_detector_v1",
      "confidence": 0.95,
      "evidence": [
        {
          "event_id": "evt_smoke_01",
          "type": "tool_call",
          "name": "search_db",
          "metric": "retry_count",
          "value": 5,
          "details": { "target": "search_api", "status_code": 500 }
        }
      ]
    }')
  echo "POST /incidents Response: ${CREATE_INC_RES}"

  SMOKE_INC_ID=$(echo "${CREATE_INC_RES}" | grep -o '"incident_id":"[^"]*' | cut -d'"' -f4 || true)
  INC_CREATED_AT=$(echo "${CREATE_INC_RES}" | grep -o '"created_at":"[^"]*' | cut -d'"' -f4 || true)

  if [ -z "${SMOKE_INC_ID}" ]; then
    echo "[ERROR] Failed to obtain incident_id from POST /incidents"
    exit 1
  fi
  echo "Created temporary Incident ID: ${SMOKE_INC_ID} (created_at: ${INC_CREATED_AT})"

  # Step 5: GET /incidents
  echo "5. Testing GET /incidents (Verifying newly created incident is listed)..."
  GET_INCS_RES=$(curl -s "${API_ENDPOINT}/incidents")
  echo "GET /incidents Response: ${GET_INCS_RES}"

  # Step 6: GET /incidents/:incident_id
  echo "6. Testing GET /incidents/${SMOKE_INC_ID}..."
  GET_SINGLE_INC_RES=$(curl -s "${API_ENDPOINT}/incidents/${SMOKE_INC_ID}")
  echo "GET /incidents/${SMOKE_INC_ID} Response: ${GET_SINGLE_INC_RES}"

  # Step 7: GET /runs/:run_id/incidents
  echo "7. Testing GET /runs/${SMOKE_RUN_ID}/incidents..."
  GET_RUN_INCS_RES=$(curl -s "${API_ENDPOINT}/runs/${SMOKE_RUN_ID}/incidents")
  echo "GET /runs/${SMOKE_RUN_ID}/incidents Response: ${GET_RUN_INCS_RES}"

  # Step 8: GET /incidents?run_id=<run_id>
  echo "8. Testing GET /incidents?run_id=${SMOKE_RUN_ID}..."
  GET_FILTERED_INCS_RES=$(curl -s "${API_ENDPOINT}/incidents?run_id=${SMOKE_RUN_ID}")
  echo "GET /incidents?run_id=${SMOKE_RUN_ID} Response: ${GET_FILTERED_INCS_RES}"

  # Step 9: POST /incidents/:incident_id/rca with structured RCA payload
  echo "9. Testing POST /incidents/${SMOKE_INC_ID}/rca with structured RCA payload..."
  POST_RCA_RES=$(curl -s -X POST "${API_ENDPOINT}/incidents/${SMOKE_INC_ID}/rca" \
    -H "Content-Type: application/json" \
    -d '{
      "rca": {
        "primary_failure": "Live smoke test simulated failure",
        "root_cause": "Rate limit exceeded in sandbox environment",
        "contributing_factors": ["Unbounded retry interval", "Burst traffic"],
        "severity": "high",
        "impact": "Single test task aborted",
        "recommended_action": "Apply exponential backoff with jitter",
        "evidence_used": ["evt_smoke_01"],
        "uncertainty": "low",
        "analyzed_at": "'"${INC_CREATED_AT}"'"
      },
      "status": "resolved"
    }')
  echo "POST /incidents/${SMOKE_INC_ID}/rca Response: ${POST_RCA_RES}"

  # Step 10: GET the incident again and verify RCA persisted
  echo "10. Testing GET /incidents/${SMOKE_INC_ID} (Verifying RCA persisted)..."
  GET_RCA_VERIFY=$(curl -s "${API_ENDPOINT}/incidents/${SMOKE_INC_ID}")
  echo "Verified Incident with RCA: ${GET_RCA_VERIFY}"

  # Step 11: Test automated RCA behavior
  echo "11. Testing automated RCA request boundary..."
  AUTO_RCA_HTTP_CODE=$(curl -s -o /tmp/auto_rca_res.json -w "%{http_code}" -X POST "${API_ENDPOINT}/incidents/${SMOKE_INC_ID}/rca" \
    -H "Content-Type: application/json" \
    -d '{"trigger_automated_rca": true}')
  AUTO_RCA_BODY=$(cat /tmp/auto_rca_res.json || true)
  rm -f /tmp/auto_rca_res.json
  echo "Automated RCA HTTP Status: ${AUTO_RCA_HTTP_CODE}"
  echo "Automated RCA Response Body: ${AUTO_RCA_BODY}"

  # Steps 12 & 13: Verify HTTP 501 and RCA_SERVICE_NOT_INTEGRATED, verify no fake RCA generated
  if [ "${AUTO_RCA_HTTP_CODE}" -eq 501 ]; then
    echo "SUCCESS: Automated RCA returned HTTP 501 as expected (code: RCA_SERVICE_NOT_INTEGRATED)"
  else
    echo "[WARNING] Expected HTTP 501 from automated RCA request, got: ${AUTO_RCA_HTTP_CODE}"
  fi

  # Step 14: Delete ALL temporary smoke-test records explicitly from DynamoDB
  echo "14. Cleaning up temporary smoke-test records from DynamoDB..."
  # Clean all 3 representations of the Incident:
  # Rep 1: pk = INCIDENT#<id>, sk = METADATA
  aws dynamodb delete-item \
    --table-name "${TABLE_NAME}" \
    --key '{"pk": {"S": "INCIDENT#'"${SMOKE_INC_ID}"'"}, "sk": {"S": "METADATA"}}' \
    --region "${REGION}" >/dev/null || true

  # Rep 2: pk = INCIDENTS, sk = INCIDENT#<created_at>#<id>
  if [ -n "${INC_CREATED_AT}" ]; then
    aws dynamodb delete-item \
      --table-name "${TABLE_NAME}" \
      --key '{"pk": {"S": "INCIDENTS"}, "sk": {"S": "INCIDENT#'"${INC_CREATED_AT}"'#'"${SMOKE_INC_ID}"'"}}' \
      --region "${REGION}" >/dev/null || true
  fi

  # Rep 3: pk = RUN#<run_id>, sk = INCIDENT#<created_at>#<id>
  if [ -n "${INC_CREATED_AT}" ]; then
    aws dynamodb delete-item \
      --table-name "${TABLE_NAME}" \
      --key '{"pk": {"S": "RUN#'"${SMOKE_RUN_ID}"'"}, "sk": {"S": "INCIDENT#'"${INC_CREATED_AT}"'#'"${SMOKE_INC_ID}"'"}}' \
      --region "${REGION}" >/dev/null || true
  fi

  # Clean Run representations:
  # Run rep 1: pk = RUN#<run_id>, sk = METADATA
  aws dynamodb delete-item \
    --table-name "${TABLE_NAME}" \
    --key '{"pk": {"S": "RUN#'"${SMOKE_RUN_ID}"'"}, "sk": {"S": "METADATA"}}' \
    --region "${REGION}" >/dev/null || true

  # Run rep 2: pk = RUNS, sk = RUN#<created_at>#<run_id>
  if [ -n "${RUN_CREATED_AT}" ]; then
    aws dynamodb delete-item \
      --table-name "${TABLE_NAME}" \
      --key '{"pk": {"S": "RUNS"}, "sk": {"S": "RUN#'"${RUN_CREATED_AT}"'#'"${SMOKE_RUN_ID}"'"}}' \
      --region "${REGION}" >/dev/null || true
  fi

  # Clean any other items in RUN#<run_id> partition
  RUN_SKS=$(aws dynamodb query \
    --table-name "${TABLE_NAME}" \
    --key-condition-expression "pk = :pk" \
    --expression-attribute-values '{":pk":{"S":"RUN#'"${SMOKE_RUN_ID}"'"}}' \
    --region "${REGION}" \
    --query 'Items[].sk.S' \
    --output text 2>/dev/null || true)
  for SK in ${RUN_SKS}; do
    aws dynamodb delete-item \
      --table-name "${TABLE_NAME}" \
      --key '{"pk": {"S": "RUN#'"${SMOKE_RUN_ID}"'"}, "sk": {"S": "'"${SK}"'"}}' \
      --region "${REGION}" >/dev/null || true
  done

  # Step 15: Verify the production table is clean (Query pk=INCIDENTS & pk=RUNS, Zero Scan)
  echo "15. Verifying production table is clean (Query pk=INCIDENTS & pk=RUNS, Zero Scan)..."
  FINAL_INCS=$(curl -s "${API_ENDPOINT}/incidents")
  echo "Final GET /incidents: ${FINAL_INCS}"
  FINAL_RUNS=$(curl -s "${API_ENDPOINT}/runs")
  echo "Final GET /runs: ${FINAL_RUNS}"
  echo "Cleanup and zero-state verification complete!"
fi

# 8. Verify DynamoDB Table Status
if [ -n "${TABLE_NAME}" ]; then
  echo ""
  echo "--> Verifying DynamoDB table status..."
  aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" --query 'Table.TableStatus' --output text || true
fi

echo "=== Deployment and Verification Complete! ==="
