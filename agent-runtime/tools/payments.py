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


def find_detail_value(value: object, keys: set[str]) -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in keys and isinstance(item, str) and item:
                return item

        for item in value.values():
            found = find_detail_value(item, keys)
            if found:
                return found

    if isinstance(value, list):
        for item in value:
            found = find_detail_value(item, keys)
            if found:
                return found

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
def list_payment_instruments() -> dict:
    """List AgentCore Payments instruments for the current Cognito user."""
    user = current_user.get()

    if not user:
        return {
            "status": "error",
            "message": "Authenticated Cognito user context is required.",
        }

    instruments = get_payment_manager().list_payment_instruments(
        user_id=user.user_id,
    )

    return {
        "status": "ok",
        "userId": user.user_id,
        "instruments": instruments,
    }


@tool
def create_payment_session(
    max_spend_amount: str = "10.00",
    currency: str = "USD",
    expiry_time_in_minutes: int = 60,
) -> dict:
    """Create a bounded AgentCore Payments session for the current Cognito user.

    Args:
        max_spend_amount: Maximum amount the session can spend.
        currency: Currency code for the spending limit.
        expiry_time_in_minutes: Session lifetime in minutes.
    """
    user = current_user.get()

    if not user:
        return {
            "status": "error",
            "message": "Authenticated Cognito user context is required.",
        }

    session = create_payment_session_for_user(
        user_id=user.user_id,
        max_spend_amount=max_spend_amount,
        currency=currency,
        expiry_time_in_minutes=expiry_time_in_minutes,
    )

    return {
        "status": "created",
        "userId": user.user_id,
        "paymentSessionId": session.get("paymentSessionId"),
        "session": session,
    }


@tool
def get_payment_instrument(payment_instrument_id: str) -> dict:
    """Get an AgentCore Payments instrument for the current Cognito user.

    Args:
        payment_instrument_id: PaymentInstrument ID to inspect.
    """
    user = current_user.get()

    if not user:
        return {
            "status": "error",
            "message": "Authenticated Cognito user context is required.",
        }

    instrument = get_payment_manager().get_payment_instrument(
        user_id=user.user_id,
        payment_instrument_id=payment_instrument_id,
    )

    return {
        "status": "ok",
        "userId": user.user_id,
        "paymentInstrumentId": payment_instrument_id,
        "instrument": instrument,
    }


@tool
def request_wallet_authorization() -> dict:
    """Request the frontend to let the current user authorize the active wallet signer."""
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
    wallet_address = find_detail_value(
        instrument,
        {"walletAddress", "address"},
    )
    network = find_detail_value(instrument, {"network", "chain"})

    if not wallet_address:
        return {
            "status": "error",
            "message": "The active payment instrument has no wallet address.",
            "paymentInstrumentId": payment_instrument_id,
        }

    return {
        "status": "authorization_required",
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
        "userId": user.user_id,
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

    return {
        "status": "created",
        "userId": user.user_id,
        "network": network,
        "paymentInstrumentId": instrument.get("paymentInstrumentId"),
        "instrumentStatus": instrument.get("status"),
        "redirectUrl": instrument.get("redirectUrl"),
        "raw": instrument,
    }


@tool
def get_payment_instrument_balance(
    payment_instrument_id: str,
    chain: str = "BASE_SEPOLIA",
    token: str = "USDC",
) -> dict:
    """Get the current balance for an AgentCore Payments instrument.

    Args:
        payment_instrument_id: PaymentInstrument ID to inspect.
        chain: Chain to inspect, such as BASE_SEPOLIA, BASE, SOLANA_DEVNET, or SOLANA_MAINNET.
        token: Token symbol to inspect, such as USDC.
    """
    user = current_user.get()

    if not user:
        return {
            "status": "error",
            "message": "Authenticated Cognito user context is required.",
        }

    balance = get_payment_manager().get_payment_instrument_balance(
        user_id=user.user_id,
        payment_connector_id=get_payment_connector_id(),
        payment_instrument_id=payment_instrument_id,
        chain=chain,
        token=token,
    )

    return {
        "status": "ok",
        "userId": user.user_id,
        "paymentInstrumentId": payment_instrument_id,
        "chain": chain,
        "token": token,
        "balance": balance,
    }
