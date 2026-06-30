import boto3


ROLE_PREFIX = "AmazonBedrockAgentCorePaymentsDefaultServiceRole"


def main() -> int:
    iam = boto3.client("iam")
    paginator = iam.get_paginator("list_roles")

    for page in paginator.paginate(PathPrefix="/service-role/"):
        for role in page.get("Roles", []):
            role_name = role.get("RoleName", "")

            if role_name.startswith(ROLE_PREFIX):
                print(role_name)
                return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
