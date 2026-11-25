"""Frames of the connected agent protocol.

Every frame is one JSON text message over the socket and carries `type` and
`protocol`. The shapes match the contract table of ADR-128. Builders return
plain dicts so the client serializes them with `json.dumps` and nothing else.
"""

from __future__ import annotations

from typing import Any, Literal

from typing_extensions import NotRequired, TypedDict

PROTOCOL_VERSION = 1

CONNECT_PATH = "/api/v1/agents/connect"

# Frame sizes in bytes. The socket frame cap follows the platform default; a
# self-hosted deployment can raise it, and the client only needs to accept
# what the platform sends.
MAX_FRAME_BYTES = 64 * 1024 * 1024

Message = dict[str, Any]
"""One OpenAI-style chat message: a dict with `role` and `content`."""

ErrorCode = Literal[
    "agent_busy",
    "agent_call_failed",
    "agent_call_timeout",
    "agent_parameter_invalid",
    "agent_payload_too_large",
    "hook_not_declared",
]

CallKind = Literal["turn", "setup", "teardown"]


class SdkInfo(TypedDict):
    name: str
    version: str
    language: str


class InstanceInfo(TypedDict):
    id: str
    hostname: str
    username: str
    pid: int
    startedAt: str
    label: NotRequired[str]
    inFlightCallIds: list[str]


class AgentHooks(TypedDict):
    setup: bool
    teardown: bool


class AgentRegistration(TypedDict):
    name: str
    environment: str
    parameters: dict[str, Any]
    concurrency: NotRequired[int]
    timeoutMs: NotRequired[int]
    sticky: NotRequired[bool]
    hooks: NotRequired[AgentHooks]


class RegisterFrame(TypedDict):
    type: Literal["register"]
    protocol: int
    sdk: SdkInfo
    instance: InstanceInfo
    agents: list[AgentRegistration]


class RegisteredAgent(TypedDict):
    name: str
    environment: str
    id: str
    url: str
    parameterNotes: list[str]


class RegisteredFrame(TypedDict):
    type: Literal["registered"]
    protocol: int
    agents: list[RegisteredAgent]
    heartbeatIntervalMs: int
    instanceId: str


class RefusedFrame(TypedDict):
    type: Literal["refused"]
    protocol: int
    code: str
    message: str


class CallRun(TypedDict, total=False):
    scenarioRunId: str
    scenarioName: str
    batchRunId: str


class CallFrame(TypedDict):
    type: Literal["call"]
    protocol: int
    kind: NotRequired[CallKind]
    callId: str
    agentId: str
    threadId: str
    messages: list[Message]
    newMessages: list[Message]
    params: dict[str, Any]
    session: Any
    state: NotRequired[dict[str, Any] | None]
    traceparent: str | None
    deadlineAt: int | float | str
    run: CallRun


class AckFrame(TypedDict):
    type: Literal["ack"]
    protocol: int
    callId: str


class ResultError(TypedDict):
    code: str
    message: str


class ResultFrame(TypedDict):
    type: Literal["result"]
    protocol: int
    callId: str
    output: NotRequired[str | Message | list[Message]]
    session: NotRequired[Any]
    state: NotRequired[dict[str, Any]]
    error: NotRequired[ResultError]


class CancelFrame(TypedDict):
    type: Literal["cancel"]
    protocol: int
    callId: str


class DeregisterFrame(TypedDict):
    type: Literal["deregister"]
    protocol: int


def register_frame(
    *,
    sdk: SdkInfo,
    instance: InstanceInfo,
    agents: list[AgentRegistration],
) -> RegisterFrame:
    return {
        "type": "register",
        "protocol": PROTOCOL_VERSION,
        "sdk": sdk,
        "instance": instance,
        "agents": agents,
    }


def ack_frame(call_id: str) -> AckFrame:
    return {"type": "ack", "protocol": PROTOCOL_VERSION, "callId": call_id}


def result_frame(
    *,
    call_id: str,
    output: str | Message | list[Message] | None = None,
    session: Any = None,
    state: dict[str, Any] | None = None,
) -> ResultFrame:
    """A result; a hook answers with a state and no output, or with nothing."""
    frame: ResultFrame = {
        "type": "result",
        "protocol": PROTOCOL_VERSION,
        "callId": call_id,
    }
    if output is not None:
        frame["output"] = output
    if session is not None:
        frame["session"] = session
    if state is not None:
        frame["state"] = state
    return frame


def error_result_frame(*, call_id: str, code: str, message: str) -> ResultFrame:
    return {
        "type": "result",
        "protocol": PROTOCOL_VERSION,
        "callId": call_id,
        "error": {"code": code, "message": message},
    }


def deregister_frame() -> DeregisterFrame:
    return {"type": "deregister", "protocol": PROTOCOL_VERSION}
