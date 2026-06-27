#!/bin/bash


set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-github-stats}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
STACK_NAME="${PROJECT_NAME}-stack"

echo "Reading current stack parameters..."
CURRENT_PARAMS=$(aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Parameters" --output json)



PARAM_ARGS=()
while IFS= read -r key; do
  if [ "${key}" = "EnableNatGateway" ]; then
    PARAM_ARGS+=("ParameterKey=EnableNatGateway,ParameterValue=false")
  else
    PARAM_ARGS+=("ParameterKey=${key},UsePreviousValue=true")
  fi
done < <(echo "${CURRENT_PARAMS}" | python3 -c "import sys,json; [print(p['ParameterKey']) for p in json.load(sys.stdin)]")

echo "Updating stack with NAT gateway disabled..."
aws cloudformation update-stack \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --use-previous-template \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters "${PARAM_ARGS[@]}"

aws cloudformation wait stack-update-complete \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}"

echo "Verifying no NAT gateways or unattached EIPs remain..."
aws ec2 describe-nat-gateways \
  --region "${AWS_REGION}" \
  --filter "Name=state,Values=available,pending" \
  --query "NatGateways[].NatGatewayId" --output text

aws ec2 describe-addresses \
  --region "${AWS_REGION}" \
  --query "Addresses[?AssociationId==null].PublicIp" --output text

echo "Both lists above should be empty. If not, investigate before walking away."
