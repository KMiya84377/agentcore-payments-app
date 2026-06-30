#!/usr/bin/env sh
set -eu

CONFIG_FILE="${BACKEND_DEPLOY_ENV_FILE:-backend.env}"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Missing $CONFIG_FILE"
  echo "Copy backend.env.example to $CONFIG_FILE and fill the real Payments values."
  exit 1
fi

set -a
. "$CONFIG_FILE"
set +a

export AWS_REGION="${AWS_REGION:-us-east-1}"
export CDK_DEFAULT_REGION="$AWS_REGION"
export AMPLIFY_IDENTIFIER="${AMPLIFY_IDENTIFIER:-dev}"
export PAYMENTS_REGION="$AWS_REGION"

if [ -z "${PAYMENT_MANAGER_ARN:-}" ]; then
  echo "PAYMENT_MANAGER_ARN is required in $CONFIG_FILE"
  exit 1
fi

if [ -z "${PAYMENT_CONNECTOR_ID:-}" ]; then
  echo "PAYMENT_CONNECTOR_ID is required in $CONFIG_FILE"
  exit 1
fi

export PAYMENT_CREDENTIAL_PROVIDER_ARN="${PAYMENT_CREDENTIAL_PROVIDER_ARN:-$(python3 scripts/resolve-payment-credential-provider-arn.py)}"
export PAYMENT_SERVICE_ROLE_NAME="${PAYMENT_SERVICE_ROLE_NAME:-$(python3 scripts/resolve-payment-service-role-name.py)}"

exec npx ampx sandbox --identifier "$AMPLIFY_IDENTIFIER"
