#!/bin/bash
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-github-stats}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
STACK_NAME="${PROJECT_NAME}-stack"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
ENABLE_NAT="${ENABLE_NAT:-false}"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
APP_BUCKET="${PROJECT_NAME}-appcode-${ACCOUNT_ID}-${AWS_REGION}"

echo "== 1. Ensure app-code bucket exists: ${APP_BUCKET}"
if ! aws s3api head-bucket --bucket "${APP_BUCKET}" --region "${AWS_REGION}" 2>/dev/null; then
  aws s3 mb "s3://${APP_BUCKET}" --region "${AWS_REGION}"
fi

echo "== 2. Upload app code"
aws s3 sync ../app/ "s3://${APP_BUCKET}/app/" \
  --region "${AWS_REGION}" \
  --exclude "node_modules/*" \
  --exclude "package-lock.json"

echo "== 3. Deploy CloudFormation stack: ${STACK_NAME}"
aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ProjectName="${PROJECT_NAME}" \
    AppCodeBucket="${APP_BUCKET}" \
    GitHubToken="${GITHUB_TOKEN}" \
    EnableNatGateway="${ENABLE_NAT}"

echo "== 4. Outputs"
aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs" \
  --output table
