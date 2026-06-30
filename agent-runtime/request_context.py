from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class RequestUser:
    user_id: str
    email: str | None = None


current_user: ContextVar[RequestUser | None] = ContextVar(
    "current_user",
    default=None,
)
