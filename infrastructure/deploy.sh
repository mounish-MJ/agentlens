#!/usr/bin/env bash
set -euo pipefail

# 1. Resolve Region (Priority: AWS_REGION env var -> AWS CLI configured region -> default us-east-1)
CLI_REGION=$(aws configure get region 2>/dev/null || true)
REGION="${AWS_REGION:-${CLI_REGION:-us-east-1}}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
STACK_NAME="agentlens-backend-${ENVIRONMENT}-stack"
TEMPLATE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/template.yaml"

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

# 3. Build Backend TypeScript
echo "--> Compiling backend TypeScript..."
npm --prefix "$(dirname "$0")/../backend" run build

# 4. Deploy CloudFormation Stack
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

echo "--> CloudFormation deployment succeeded!"

# 5. Extract Stack Outputs
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

# 6. Verify Deployed Health Endpoint
if [ -n "${HEALTH_URL}" ]; then
  echo "--> Testing deployed /health endpoint..."
  curl -s -i "${HEALTH_URL}"
  echo ""
fi

# 7. Verify DynamoDB Table Status
if [ -n "${TABLE_NAME}" ]; then
  echo "--> Verifying DynamoDB table status..."
  aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" --query 'Table.TableStatus' --output text || true
fi

echo "=== Deployment and Verification Complete! ==="
