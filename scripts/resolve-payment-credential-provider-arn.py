import os
import sys

import boto3


def main() -> int:
    region = os.environ.get("AWS_REGION", "us-east-1")
    payment_manager_arn = os.environ.get("PAYMENT_MANAGER_ARN")
    payment_connector_id = os.environ.get("PAYMENT_CONNECTOR_ID")

    if not payment_manager_arn or not payment_connector_id:
        print(
            "PAYMENT_MANAGER_ARN and PAYMENT_CONNECTOR_ID are required.",
            file=sys.stderr,
        )
        return 1

    payment_manager_id = payment_manager_arn.rsplit("/", 1)[-1]
    client = boto3.client("bedrock-agentcore-control", region_name=region)
    connector = client.get_payment_connector(
        paymentManagerId=payment_manager_id,
        paymentConnectorId=payment_connector_id,
    )

    for configuration in connector.get("credentialProviderConfigurations", []):
        stripe_privy = configuration.get("stripePrivy")

        if stripe_privy and stripe_privy.get("credentialProviderArn"):
            print(stripe_privy["credentialProviderArn"])
            return 0

    print(
        "No credential provider ARN found on the payment connector.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
