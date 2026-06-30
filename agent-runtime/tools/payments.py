import os
from typing import Literal

from bedrock_agentcore.payments import PaymentManager
from strands import tool

from request_context import current_user


def get_payment_manager() -> PaymentManager:
    payment_manager_arn = os.getenv("PAYMENT_MANAGER_ARN")

    if not payment_manager_arn:
        raise RuntimeError("PAYMENT_MANAGER_ARN is not configured.")

    return PaymentManager(
        payment_manager_arn=payment_manager_arn,
        region_name=os.getenv("PAYMENTS_REGION", "us-east-1"),
    )


def get_payment_connector_id() -> str:
    payment_connector_id = os.getenv("PAYMENT_CONNECTOR_ID")

    if not payment_connector_id:
        raise RuntimeError("PAYMENT_CONNECTOR_ID is not configured.")

    return payment_connector_id


def find_active_payment_instrument(user_id: str) -> dict | None:
    instruments = get_payment_manager().list_payment_instruments(
        user_id=user_id,
    )
    instrument_items = instruments.get("paymentInstruments", [])

    for instrument in instrument_items:
        if instrument.get("status") == "ACTIVE":
            return instrument

    return None


def create_payment_session_for_user(
    user_id: str,
    max_spend_amount: str = "10.00",
    currency: str = "USD",
    expiry_time_in_minutes: int = 60,
) -> dict:
    return get_payment_manager().create_payment_session(
        user_id=user_id,
        expiry_time_in_minutes=expiry_time_in_minutes,
        limits={
            "maxSpendAmount": {
                "value": max_spend_amount,
                "currency": currency,
            },
        },
    )


@tool
def prepare_wallet_authorization() -> dict:
    """Get the active wallet details needed by the frontend authorization tool."""
    user = current_user.get()

    if not user:
        return {
            "status": "error",
            "message": "Authenticated Cognito user context is required.",
        }

    active_instrument = find_active_payment_instrument(user.user_id)

    if not active_instrument:
        return {
            "status": "instrument_required",
            "message": "An active payment instrument is required before signer authorization.",
        }

    payment_instrument_id = active_instrument.get("paymentInstrumentId")

    if not isinstance(payment_instrument_id, str):
        return {
            "status": "error",
            "message": "The active payment instrument has no instrument ID.",
        }

    instrument = get_payment_manager().get_payment_instrument(
        user_id=user.user_id,
        payment_instrument_id=payment_instrument_id,
    )
    instrument_details = instrument.get("paymentInstrumentDetails", {})
    embedded_wallet = instrument_details.get("embeddedCryptoWallet", {})
    wallet_address = embedded_wallet.get("walletAddress")
    network = embedded_wallet.get("network")

    if not wallet_address:
        return {
            "status": "error",
            "message": "The active payment instrument has no wallet address.",
            "paymentInstrumentId": payment_instrument_id,
        }

    return {
        "status": "authorization_ready",
        "paymentInstrumentId": payment_instrument_id,
        "walletAddress": wallet_address,
        "network": network,
    }


@tool
def delete_payment_instrument(payment_instrument_id: str) -> dict:
    """Delete an AgentCore Payments instrument after explicit user approval.

    Args:
        payment_instrument_id: PaymentInstrument ID to delete for the current Cognito user.
    """
    user = current_user.get()

    if not user:
        return {
            "status": "error",
            "message": "Authenticated Cognito user context is required.",
        }

    manager = get_payment_manager()
    result = manager.delete_payment_instrument(
        user_id=user.user_id,
        payment_connector_id=get_payment_connector_id(),
        payment_instrument_id=payment_instrument_id,
    )

    return {
        "status": "deleted",
        "paymentInstrumentId": payment_instrument_id,
        "result": result,
    }


@tool
def create_payment_instrument(
    network: Literal["ETHEREUM", "SOLANA"] = "ETHEREUM",
) -> dict:
    """Create an AgentCore Payments instrument after explicit user approval.

    Args:
        network: Blockchain network family. Use ETHEREUM for EVM networks such as Base.
    """
    user = current_user.get()

    if not user:
        return {
            "status": "error",
            "message": "Authenticated Cognito user context is required.",
        }

    if not user.email:
        return {
            "status": "error",
            "message": "Cognito email claim is required to create a linked payment instrument.",
        }

    embedded_wallet: dict = {
        "network": network,
        "linkedAccounts": [
            {"email": {"emailAddress": user.email}},
        ],
    }

    manager = get_payment_manager()
    instrument = manager.create_payment_instrument(
        user_id=user.user_id,
        payment_connector_id=get_payment_connector_id(),
        payment_instrument_type="EMBEDDED_CRYPTO_WALLET",
        payment_instrument_details={
            "embeddedCryptoWallet": embedded_wallet,
        },
    )
    instrument_details = instrument.get("paymentInstrumentDetails", {})
    created_wallet = instrument_details.get("embeddedCryptoWallet", {})

    return {
        "status": "created",
        "network": network,
        "paymentInstrumentId": instrument.get("paymentInstrumentId"),
        "instrumentStatus": instrument.get("status"),
        "walletAddress": created_wallet.get("walletAddress"),
        "redirectUrl": created_wallet.get("redirectUrl"),
    }
