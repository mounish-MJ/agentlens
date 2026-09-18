#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
STACK_NAME="agentlens-backend-${ENVIRONMENT}-stack"
TEMPLATE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/template.yaml"

echo "=== AgentLens AWS Backend Foundation Deployment ==="
echo "Target Region:      ${REGION}"
echo "Environment:        ${ENVIRONMENT}"
echo "Stack Name:         ${STACK_NAME}"
echo "Template File:      ${TEMPLATE_FILE}"
echo "==================================================="

# 1. Check AWS CLI and Credentials
echo "--> Checking AWS CLI and credentials..."
if ! command -v aws >/dev/null 2>&1; then
  echo "[ERROR] 'aws' CLI is not installed or not in PATH."
  exit 1
fi

if ! aws sts get-caller-identity --region "${REGION}" >/dev/null 2>&1; then
  echo "[ERROR] No valid AWS credentials found."
  echo "Please configure AWS credentials using 'aws configure' or export AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION."
  exit 1
fi

CALLER_IDENTITY=$(aws sts get-caller-identity --region "${REGION}" --output json)
ACCOUNT_ID=$(echo "${CALLER_IDENTITY}" | grep -o '"Account": "[^"]*' | cut -d'"' -f4)
echo "Authenticated as AWS Account: ${ACCOUNT_ID}"

# 2. Build Backend TypeScript
echo "--> Compiling backend TypeScript..."
npm --prefix "$(dirname "$0")/../backend" run build

# 3. Deploy CloudFormation Stack
echo "--> Deploying CloudFormation stack: ${STACK_NAME}..."
aws cloudformation deploy \
  --template-file "${TEMPLATE_FILE}" \
  --stack-name "${STACK_NAME}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Environment="${ENVIRONMENT}" TableName="agentlens-data" \
  --region "${REGION}" \
  --no-fail-on-empty-changeset

echo "--> Deployment finished successfully!"

# 4. Extract Stack Outputs
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

# 5. Verify Deployed Health Endpoint
if [ -n "${HEALTH_URL}" ]; then
  echo "--> Testing deployed /health endpoint..."
  curl -s -i "${HEALTH_URL}"
  echo ""
fi

# 6. Verify DynamoDB Table Status
if [ -n "${TABLE_NAME}" ]; then
  echo "--> Verifying DynamoDB table status..."
  aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" --query 'Table.TableStatus' --output text
fi

echo "=== Deployment and Verification Complete! ==="
