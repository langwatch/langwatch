"""`connect_agent`: the decorator that makes a function a simulation target.

The decorated object stays callable with the original signature, so unit
tests and local scenario runs use it as before. It also answers `.call(input)`
for the scenario library and `.invoke(call)` for the connection client.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, TypeVar, Union

from pydantic import BaseModel

from .client import register
from .identity import resolve_environment
from .protocol import AgentRegistration, CallFrame, Message
from .schema import TURN_FIELDS, AgentSignature, analyze_signature

DEFAULT_TIMEOUT_SECONDS = 120
MAX_TIMEOUT_SECONDS = 300
DEFAULT_CONCURRENCY_DEVELOPMENT = 1
DEFAULT_CONCURRENCY_SHARED = 4

F = TypeVar("F", bound=Callable[..., Any])

Output = Union[str, Message, list[Message]]


@dataclass
class AgentCall:
    """One simulation turn, with every field the platform sends."""

    messages: list[Message]
    new_messages: list[Message] = field(default_factory=list)
    thread_id: str = ""
    session: Any = None
    trace_id: str | None = None
    parameters: dict[str, Any] = field(default_factory=dict)
    call_id: str | None = None
    run: dict[str, Any] = field(default_factory=dict)
    deadline_at: str | int | float | None = None

    def turn_fields(self) -> dict[str, Any]:
        return {
            "messages": self.messages,
            "new_messages": self.new_messages,
            "thread_id": self.thread_id,
            "session": self.session,
            "trace_id": self.trace_id,
        }


@dataclass
class AgentReply:
    """The function's answer plus the session it wants back on the next turn."""

    output: Output
    session: Any = None


def coerce_reply(value: Any) -> AgentReply:
    """A string, one message, a list of messages or an AgentReply."""
    if isinstance(value, AgentReply):
        return AgentReply(
            output=coerce_reply(value.output).output, session=value.session
        )
    if value is None:
        return AgentReply(output="")
    if isinstance(value, str):
        return AgentReply(output=value)
    if isinstance(value, BaseModel):
        return coerce_reply(value.model_dump(mode="json", exclude_none=True))
    if isinstance(value, Mapping):
        return AgentReply(output=dict(value))
    if isinstance(value, (list, tuple)):
        return AgentReply(output=[coerce_reply(item).output for item in value])  # type: ignore[misc]
    return AgentReply(output=str(value))


class ConnectedAgent:
    """The decorated function with its registration and its call binding."""

    def __init__(
        self,
        func: Callable[..., Any],
        *,
        name: str,
        environment: str | None = None,
        parameters: Mapping[str, Any] | None = None,
        enabled: bool | None = None,
        instance_label: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        concurrency: int | None = None,
        sticky: bool = False,
        api_key: str | None = None,
        endpoint: str | None = None,
        project_id: str | None = None,
        transport: str | None = None,
    ) -> None:
        if inspect.isgeneratorfunction(func) or inspect.isasyncgenfunction(func):
            raise TypeError(
                f"connect_agent: {getattr(func, '__name__', 'function')} is a generator; "
                "streaming is not supported, return the full reply instead"
            )
        if not callable(func):
            raise TypeError("connect_agent: the decorated object must be callable")
        if not name or not name.strip():
            raise ValueError("connect_agent: name is required")

        self.func = func
        self.name = name.strip()
        self.environment = resolve_environment(environment)
        self.enabled = enabled
        self.instance_label = instance_label
        self.timeout = float(min(max(timeout, 1), MAX_TIMEOUT_SECONDS))
        self.concurrency = (
            concurrency
            if concurrency is not None and concurrency > 0
            else (
                DEFAULT_CONCURRENCY_DEVELOPMENT
                if self.environment == "development"
                else DEFAULT_CONCURRENCY_SHARED
            )
        )
        self.sticky = sticky
        self.api_key = api_key
        self.endpoint = endpoint
        self.project_id = project_id
        self.transport = transport
        self.is_async = inspect.iscoroutinefunction(func)
        self.signature: AgentSignature = analyze_signature(
            func, agent_call_type=AgentCall, parameters=parameters
        )
        # `updated=()` drops the default `__dict__` merge. That merge runs
        # after the assignments above, so a decorated function that already
        # carries `name`, `timeout` or `environment` would replace the values
        # this agent was built with, and it would register under an identity
        # the caller never asked for.
        functools.update_wrapper(self, func, updated=())

    @property
    def key(self) -> str:
        """`name@environment`, the identity the platform upserts by."""
        return f"{self.name}@{self.environment}"

    @property
    def timeout_ms(self) -> int:
        return int(self.timeout * 1000)

    def registration(self) -> AgentRegistration:
        frame: AgentRegistration = {
            "name": self.name,
            "environment": self.environment,
            "parameters": self.signature.json_schema(),
            "concurrency": self.concurrency,
            "timeoutMs": self.timeout_ms,
            "sticky": self.sticky,
        }
        return frame

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self.func(*args, **kwargs)

    @staticmethod
    def call_from_frame(frame: CallFrame) -> AgentCall:
        """The AgentCall for one `call` frame of the platform."""
        traceparent = frame.get("traceparent")
        trace_id: str | None = None
        if isinstance(traceparent, str):
            parts = traceparent.split("-")
            if len(parts) >= 3 and len(parts[1]) == 32:
                trace_id = parts[1]
        return AgentCall(
            messages=list(frame.get("messages") or []),
            new_messages=list(frame.get("newMessages") or []),
            thread_id=str(frame.get("threadId") or ""),
            session=frame.get("session"),
            trace_id=trace_id,
            parameters=dict(frame.get("params") or {}),
            call_id=frame.get("callId"),
            run=dict(frame.get("run") or {}),
            deadline_at=frame.get("deadlineAt"),
        )

    def bind(self, call: AgentCall) -> tuple[list[Any], dict[str, Any]]:
        """Positional and keyword arguments for one call.

        Turn fields go by declared name only, `**kwargs` receives all of them,
        and an `AgentCall` first parameter receives the object. Run parameters
        are validated here, so a bad value never reaches the function.
        """
        parameters = self.signature.resolve_parameters(call.parameters)
        call.parameters = parameters
        args: list[Any] = []
        kwargs: dict[str, Any] = {}
        turn_fields = call.turn_fields()
        if self.signature.call_parameter is not None:
            args.append(call)
        if self.signature.has_kwargs:
            kwargs.update(turn_fields)
        else:
            for name in self.signature.turn_fields:
                kwargs[name] = turn_fields[name]
        kwargs.update(parameters)
        return args, kwargs

    async def invoke(self, call: AgentCall) -> AgentReply:
        """Run the function for one call and coerce what it returns.

        A sync function runs in a worker thread so the connection loop stays
        free; an async function is awaited on the calling loop. The current
        context, and so the adopted trace, travels into the worker thread.
        """
        args, kwargs = self.bind(call)
        if self.is_async:
            result = await self.func(*args, **kwargs)
        else:
            result = await asyncio.to_thread(self.func, *args, **kwargs)
            if inspect.isawaitable(result):
                result = await result
        return coerce_reply(result)

    async def call(self, input: Any) -> Output:
        """Duck-typed entry for the scenario library's `AgentAdapter.call`.

        Reads `messages`, `new_messages` and `thread_id` from the input, as
        attributes or as keys, and returns the output alone.
        """

        def read(name: str, default: Any) -> Any:
            if isinstance(input, Mapping):
                return input.get(name, default)
            return getattr(input, name, default)

        messages = list(read("messages", []) or [])
        call = AgentCall(
            messages=messages,
            new_messages=list(read("new_messages", []) or []),
            thread_id=str(read("thread_id", "") or ""),
            session=read("session", None),
            trace_id=read("trace_id", None),
            parameters=dict(read("parameters", {}) or {}),
        )
        reply = await self.invoke(call)
        return reply.output


def connect_agent(
    name: str,
    *,
    environment: str | None = None,
    parameters: Mapping[str, Any] | None = None,
    enabled: bool | None = None,
    instance_label: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    concurrency: int | None = None,
    sticky: bool = False,
    api_key: str | None = None,
    endpoint: str | None = None,
    project_id: str | None = None,
    transport: str | None = None,
) -> Callable[[F], F]:
    """Connect the function that runs your agent to LangWatch Agent Testing.

    The function receives the turn fields it declares (`messages`,
    `new_messages`, `thread_id`, `session`, `trace_id`), and every other
    parameter with a default is a run parameter the platform can set. The
    connection starts once per process, lazily, on a daemon thread.

    Args:
        name: The agent name shown on the platform.
        environment: Overrides `LANGWATCH_AGENT_ENVIRONMENT`, `APP_ENV`,
            `ENVIRONMENT` and `NODE_ENV`; defaults to `development`.
        parameters: Replaces the run parameters read from the signature.
        enabled: Whether this process connects. Takes any boolean, so one
            expression can gate the deployments that connect, for example
            `os.environ.get("APP_ENV") != "production"`. Defaults to true,
            except when `CI` is truthy; `LANGWATCH_AGENT_CONNECT=0` always
            disables.
        instance_label: Names this process; also `LANGWATCH_AGENT_INSTANCE_LABEL`.
        timeout: Seconds one call may take, default 120, at most 300.
        concurrency: Calls in flight per process, default 1 in development and 4 elsewhere.
        sticky: Keep one conversation on one process.
        api_key, endpoint, project_id: Override the SDK configuration.
        transport: `websocket` (default, falls back to HTTP when the upgrade
            is refused) or `http`; also `LANGWATCH_AGENT_TRANSPORT`.
    """

    def decorate(func: F) -> F:
        agent = ConnectedAgent(
            func,
            name=name,
            environment=environment,
            parameters=parameters,
            enabled=enabled,
            instance_label=instance_label,
            timeout=timeout,
            concurrency=concurrency,
            sticky=sticky,
            api_key=api_key,
            endpoint=endpoint,
            project_id=project_id,
            transport=transport,
        )
        register(agent)
        return agent  # type: ignore[return-value]

    return decorate


__all__ = [
    "TURN_FIELDS",
    "AgentCall",
    "AgentReply",
    "ConnectedAgent",
    "coerce_reply",
    "connect_agent",
]
