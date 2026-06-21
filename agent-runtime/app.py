import os
import logging
from pathlib import Path
from typing import Any

import uvicorn
from ag_ui.core import RunAgentInput
from ag_ui.encoder import EventEncoder
from ag_ui_strands import StrandsAgent, StrandsAgentConfig
from bedrock_agentcore.payments.integrations.strands import (
    AgentCorePaymentsPlugin,
    AgentCorePaymentsPluginConfig,
)
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from strands import Agent
from strands.models.bedrock import BedrockModel

from request_context import RequestUser, current_user
from tools.payments import (
    create_payment_session,
    create_payment_instrument,
    create_payment_session_for_user,
    delete_payment_instrument,
    find_active_payment_instrument,
    get_payment_instrument,
    get_payment_instrument_balance,
    list_payment_instruments,
    request_wallet_authorization,
)


AGENTCORE_USER_SUB_HEADER = (
    "x-amzn-bedrock-agentcore-runtime-custom-user-sub"
)
AGENTCORE_USER_EMAIL_HEADER = (
    "x-amzn-bedrock-agentcore-runtime-custom-user-email"
)
PROMPT_PATH = Path(__file__).parent / "prompts" / "system_prompt.md"
logging.basicConfig(
    level=os.getenv("AGENT_LOG_LEVEL", "INFO"),
    format="%(levelname)s:%(name)s:%(message)s",
)
logging.getLogger("bedrock_agentcore.payments.integrations.strands.plugin").setLevel(
    os.getenv("AGENTCORE_PAYMENTS_PLUGIN_LOG_LEVEL", "DEBUG"),
)
logging.getLogger("bedrock_agentcore.payments.integrations.handlers").setLevel(
    os.getenv("AGENTCORE_PAYMENTS_HANDLER_LOG_LEVEL", "DEBUG"),
)
logging.getLogger("bedrock_agentcore.payments.manager").setLevel(
    os.getenv("AGENTCORE_PAYMENTS_MANAGER_LOG_LEVEL", "INFO"),
)
logger = logging.getLogger("agentcore_payments_app")


def sanitize_agui_history_for_bedrock(input_data: dict[str, Any]) -> dict[str, Any]:
    """Remove historical AG-UI tool calls before replaying history to Bedrock."""
    messages = input_data.get("messages")

    if not isinstance(messages, list):
        return input_data

    normalized_messages: list[Any] = []

    for message in messages:
        if not isinstance(message, dict):
            normalized_messages.append(message)
            continue

        role = message.get("role")

        if role == "tool":
            continue

        if role != "assistant":
            normalized_messages.append(message)
            continue

        sanitized_message = {
            key: value
            for key, value in message.items()
            if key not in ("toolCalls", "tool_calls")
        }
        content = sanitized_message.get("content")

        if isinstance(content, list):
            sanitized_message["content"] = [
                part
                for part in content
                if not (isinstance(part, dict) and part.get("type") == "tool-call")
            ]

        normalized_messages.append(sanitized_message)

    return {
        **input_data,
        "messages": normalized_messages,
    }


def get_request_user(request: Request) -> RequestUser | None:
    user_id = request.headers.get(AGENTCORE_USER_SUB_HEADER)
    email = request.headers.get(AGENTCORE_USER_EMAIL_HEADER)

    if not user_id:
        return None

    return RequestUser(
        user_id=user_id,
        email=email,
    )


def load_system_prompt() -> str:
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    paid_weather_api_url = os.getenv("PAID_WEATHER_API_URL")

    if not paid_weather_api_url:
        return prompt

    return (
        prompt
        + "\n\n"
        + "検証用のx402有料API:\n"
        + f"- URL: {paid_weather_api_url}\n"
        + "- 用途: AgentCore Payments Plugin の支払い疎通確認\n"
        + "- 価格: $0.001 USDC相当のテスト用少額支払い\n"
        + "- ネットワーク: Base Sepolia (eip155:84532)\n"
        + "- ユーザーが明示的に支払い検証を許可した場合だけ、"
        + "http_request ツールでこのURLへGETリクエストする\n"
    )


def create_payments_plugin(
    user: RequestUser | None,
) -> AgentCorePaymentsPlugin | None:
    payment_manager_arn = os.getenv("PAYMENT_MANAGER_ARN")

    if not payment_manager_arn:
        logger.warning("payments_plugin disabled: PAYMENT_MANAGER_ARN missing")
        return None

    if not user:
        logger.warning("payments_plugin disabled: user context missing")
        return None

    instrument = find_active_payment_instrument(user.user_id)

    if not instrument:
        logger.warning("payments_plugin disabled: active instrument not found")
        return None

    payment_instrument_id = instrument.get("paymentInstrumentId")

    if not isinstance(payment_instrument_id, str):
        logger.warning("payments_plugin disabled: instrument id missing")
        return None

    session = create_payment_session_for_user(user.user_id)
    payment_session_id = session.get("paymentSessionId")

    if not isinstance(payment_session_id, str):
        logger.warning("payments_plugin disabled: payment session id missing")
        return None

    logger.warning(
        "payments_plugin enabled: instrument_present=%s session_present=%s connector_present=%s",
        bool(payment_instrument_id),
        bool(payment_session_id),
        bool(os.getenv("PAYMENT_CONNECTOR_ID")),
    )

    config = AgentCorePaymentsPluginConfig(
        payment_manager_arn=payment_manager_arn,
        user_id=user.user_id,
        payment_instrument_id=payment_instrument_id,
        payment_session_id=payment_session_id,
        payment_connector_id=os.getenv("PAYMENT_CONNECTOR_ID"),
        region=os.getenv("PAYMENTS_REGION", "us-east-1"),
        payment_tool_allowlist=["http_request"],
        agent_name="strands_agent",
    )

    return AgentCorePaymentsPlugin(config=config)


def create_agent(user: RequestUser | None = None) -> StrandsAgent:
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "ap-northeast-1"
    model_id = os.getenv(
        "BEDROCK_MODEL_ID",
        "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    )

    model = BedrockModel(
        model_id=model_id,
        region_name=region,
    )

    payments_plugin = create_payments_plugin(user)
    plugins = [payments_plugin] if payments_plugin else []
    hooks = list(payments_plugin.hooks) if payments_plugin else []
    logger.warning(
        "create_agent: payments_plugin_present=%s payment_hooks_count=%d paid_weather_api_present=%s",
        payments_plugin is not None,
        len(hooks),
        bool(os.getenv("PAID_WEATHER_API_URL")),
    )

    strands_agent = Agent(
        model=model,
        system_prompt=load_system_prompt(),
        tools=[
            list_payment_instruments,
            get_payment_instrument,
            create_payment_instrument,
            delete_payment_instrument,
            create_payment_session,
            get_payment_instrument_balance,
            request_wallet_authorization,
        ],
        plugins=plugins,
    )

    return StrandsAgent(
        agent=strands_agent,
        name="strands_agent",
        description="Strands AgentCore runtime that streams native AG-UI events.",
        hooks=hooks,
        config=StrandsAgentConfig(emit_messages_snapshot=False),
    )


app = FastAPI(title="Strands AG-UI AgentCore Runtime", version="1.0.0")


@app.post("/invocations")
async def invocations(input_data: dict, request: Request):
    accept_header = request.headers.get("accept")
    encoder = EventEncoder(accept=accept_header)
    user = get_request_user(request)

    async def event_generator():
        token = current_user.set(user)

        try:
            agui_agent = create_agent(user)
            normalized_input = sanitize_agui_history_for_bedrock(input_data)
            run_input = RunAgentInput(**normalized_input)
            async for event in agui_agent.run(run_input):
                yield encoder.encode(event)
        finally:
            current_user.reset(token)

    return StreamingResponse(
        event_generator(),
        media_type=encoder.get_content_type(),
    )


@app.get("/ping")
async def ping():
    return JSONResponse({"status": "Healthy"})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
