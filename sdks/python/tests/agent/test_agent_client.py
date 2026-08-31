# The connection client against a fake platform: register, call, ack,
# result, cancel, busy, timeout, refusal, reconnect, deregister and the
# adoption of the envelope's traceparent.
#
# See specs/python-sdk/agent-decorator.feature

import asyncio
import json
import logging
import signal
import threading
import time
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import websockets
from opentelemetry import trace
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

from langwatch.agent import AgentReply, ConnectedAgent, connect_agent
from langwatch.agent import client as client_module
from langwatch.agent.client import AgentClient
from langwatch.agent.protocol import PROTOCOL_VERSION

REMOTE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
REMOTE_SPAN_ID = "00f067aa0ba902b7"
TRACEPARENT = f"00-{REMOTE_TRACE_ID}-{REMOTE_SPAN_ID}-01"

pytestmark = pytest.mark.asyncio


class Connection:
    """One socket the fake platform accepted."""

    def __init__(self, socket: Any) -> None:
        self.socket = socket
        self.headers = {k.lower(): v for k, v in socket.request.headers.raw_items()}
        self.path = socket.request.path
        self.frames: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.closed = asyncio.Event()

    async def pump(self) -> None:
        try:
            async for raw in self.socket:
                self.frames.put_nowait(json.loads(raw))
        finally:
            self.closed.set()

    async def expect(self, kind: str, timeout: float = 5.0) -> dict[str, Any]:
        frame = await asyncio.wait_for(self.frames.get(), timeout)
        assert frame["type"] == kind, frame
        assert frame["protocol"] == PROTOCOL_VERSION
        return frame

    async def nothing(self, seconds: float = 0.3) -> None:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(self.frames.get(), seconds)

    async def send(self, frame: dict[str, Any]) -> None:
        await self.socket.send(json.dumps({"protocol": PROTOCOL_VERSION, **frame}))

    async def registered(
        self, register: dict[str, Any], **extra: Any
    ) -> dict[str, str]:
        ids = {a["name"]: f"agent_{a['name']}" for a in register["agents"]}
        await self.send(
            {
                "type": "registered",
                "agents": [
                    {
                        "name": a["name"],
                        "environment": a["environment"],
                        "id": ids[a["name"]],
                        "url": f"http://platform/agents/{ids[a['name']]}",
                        "parameterNotes": [],
                    }
                    for a in register["agents"]
                ],
                "heartbeatIntervalMs": 10000,
                "instanceId": register["instance"]["id"],
                **extra,
            }
        )
        return ids

    async def call(
        self,
        *,
        agent_id: str,
        call_id: str = "call-1",
        params: dict[str, Any] | None = None,
        session: Any = None,
        traceparent: str | None = None,
        deadline_in: float = 30.0,
    ) -> None:
        deadline = datetime.now(timezone.utc) + timedelta(seconds=deadline_in)
        await self.send(
            {
                "type": "call",
                "callId": call_id,
                "agentId": agent_id,
                "threadId": "thread-1",
                "messages": [{"role": "user", "content": "hi"}],
                "newMessages": [{"role": "user", "content": "hi"}],
                "params": params or {},
                "session": session,
                "traceparent": traceparent,
                "deadlineAt": deadline.isoformat().replace("+00:00", "Z"),
                "run": {"scenarioRunId": "run-1", "scenarioName": "Refund"},
            }
        )

    async def close(self, code: int = 1000) -> None:
        await self.socket.close(code=code)
        await self.closed.wait()


class FakePlatform:
    def __init__(self) -> None:
        self.connections: asyncio.Queue[Connection] = asyncio.Queue()
        self.server: Any = None
        self.port = 0

    async def __aenter__(self) -> "FakePlatform":
        self.server = await websockets.serve(self._handler, "127.0.0.1", 0)
        self.port = next(iter(self.server.sockets)).getsockname()[1]
        return self

    async def __aexit__(self, *_: object) -> None:
        self.server.close()
        await self.server.wait_closed()

    async def _handler(self, socket: Any) -> None:
        connection = Connection(socket)
        self.connections.put_nowait(connection)
        await connection.pump()

    async def accept(self, timeout: float = 5.0) -> Connection:
        return await asyncio.wait_for(self.connections.get(), timeout)

    @property
    def endpoint(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def make_client(platform: FakePlatform, **options: Any) -> AgentClient:
    settings: dict[str, Any] = dict(
        api_key="sk-lw-test-key",
        endpoint=platform.endpoint,
        should_install_process_hooks=False,
        should_setup_tracing=False,
        backoff_initial=0.05,
        backoff_max=0.2,
    )
    settings.update(options)
    return AgentClient(**settings)


def echo_agent(name: str = "support-agent", **options: Any) -> ConnectedAgent:
    def agent(messages, session, plan: str = "free"):
        return AgentReply(
            output=f"{plan}:{messages[-1]['content']}",
            session={"seen": (session or {}).get("seen", 0) + 1},
        )

    return ConnectedAgent(agent, name=name, environment="development", **options)


async def connect(platform: FakePlatform, *agents: ConnectedAgent, **options: Any):
    client = make_client(platform, **options)
    for agent in agents:
        client.register_agent(agent)
    connection = await platform.accept()
    register = await connection.expect("register")
    ids = await connection.registered(register)
    assert client.wait_registered(5.0)
    return client, connection, register, ids


# @scenario "Register sends the SDK, the instance and the agents"
async def test_register_carries_sdk_instance_and_agents():
    from langwatch.__version__ import __version__

    async with FakePlatform() as platform:
        client, connection, register, _ = await connect(platform, echo_agent())
        try:
            assert connection.path == "/api/v1/agents/connect"
            assert connection.headers["authorization"] == "Bearer sk-lw-test-key"
            assert connection.headers["user-agent"] == f"langwatch-python/{__version__}"
            assert "x-project-id" not in connection.headers
            assert register["sdk"] == {
                "name": "langwatch",
                "version": __version__,
                "language": "python",
            }
            assert set(register["instance"]) >= {
                "id",
                "hostname",
                "username",
                "pid",
                "startedAt",
                "inFlightCallIds",
            }
            assert register["instance"]["inFlightCallIds"] == []
            assert register["agents"] == [
                {
                    "name": "support-agent",
                    "environment": "development",
                    "parameters": {
                        "type": "object",
                        "properties": {"plan": {"type": "string", "default": "free"}},
                    },
                    "concurrency": 1,
                    "timeoutMs": 120000,
                    "sticky": False,
                }
            ]
        finally:
            await asyncio.to_thread(client.stop)


async def test_project_id_header_is_sent_when_configured():
    async with FakePlatform() as platform:
        client, connection, _, _ = await connect(
            platform, echo_agent(), project_id="proj_1"
        )
        try:
            assert connection.headers["x-project-id"] == "proj_1"
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "One connection carries every agent of the process"
async def test_one_register_carries_every_agent():
    async with FakePlatform() as platform:
        client, connection, register, _ = await connect(
            platform, echo_agent("a"), echo_agent("b")
        )
        try:
            assert [a["name"] for a in register["agents"]] == ["a", "b"]
            client.register_agent(echo_agent("c"))
            again = await connection.expect("register")
            assert [a["name"] for a in again["agents"]] == ["a", "b", "c"]
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A call is acknowledged before the function runs"
async def test_ack_is_sent_before_the_function_runs():
    started = threading.Event()
    release = threading.Event()

    def agent(messages):
        started.set()
        release.wait(5)
        return "done"

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="slow")
        )
        try:
            await connection.call(agent_id=ids["slow"])
            ack = await connection.expect("ack")
            assert ack["callId"] == "call-1"
            assert await asyncio.to_thread(started.wait, 5)
            release.set()
            result = await connection.expect("result")
            assert result == {
                "type": "result",
                "protocol": PROTOCOL_VERSION,
                "callId": "call-1",
                "output": "done",
            }
        finally:
            release.set()
            await asyncio.to_thread(client.stop)


# @scenario "The result frame carries the call id and the output"
async def test_result_carries_output_and_session():
    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(platform, echo_agent())
        try:
            await connection.call(agent_id=ids["support-agent"], params={"plan": "pro"})
            await connection.expect("ack")
            result = await connection.expect("result")
            assert result["callId"] == "call-1"
            assert result["output"] == "pro:hi"
            assert result["session"] == {"seen": 1}

            await connection.call(
                agent_id=ids["support-agent"],
                call_id="call-2",
                session=result["session"],
            )
            await connection.expect("ack")
            second = await connection.expect("result")
            assert second["session"] == {"seen": 2}
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A required parameter the run did not supply is refused before the call"
async def test_parameter_errors_are_answered_as_agent_parameter_invalid():
    ran = threading.Event()

    def agent(messages, customer_id: str):
        ran.set()
        return "ok"

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="strict")
        )
        try:
            await connection.call(agent_id=ids["strict"])
            await connection.expect("ack")
            result = await connection.expect("result")
            assert result["error"]["code"] == "agent_parameter_invalid"
            assert "customer_id" in result["error"]["message"]
            assert not ran.is_set()
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A function that raises answers agent_call_failed"
async def test_function_error_is_answered_and_the_connection_stays_open():
    def agent(messages):
        raise ValueError("no tokens left")

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="broken")
        )
        try:
            await connection.call(agent_id=ids["broken"])
            await connection.expect("ack")
            result = await connection.expect("result")
            assert result["error"] == {
                "code": "agent_call_failed",
                "message": "ValueError: no tokens left",
            }

            await connection.call(agent_id=ids["broken"], call_id="call-2")
            await connection.expect("ack")
            assert (await connection.expect("result"))["callId"] == "call-2"
            assert not connection.closed.is_set()
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A call past its deadline answers agent_call_timeout"
async def test_deadline_answers_agent_call_timeout():
    async def agent(messages):
        await asyncio.sleep(5)
        return "late"

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="slow")
        )
        try:
            await connection.call(agent_id=ids["slow"], deadline_in=0.2)
            await connection.expect("ack")
            result = await connection.expect("result")
            assert result["error"]["code"] == "agent_call_timeout"
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A cancel frame stops the running call"
async def test_cancel_stops_the_call_and_sends_no_result():
    cancelled = threading.Event()

    async def agent(messages):
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return "late"

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="slow")
        )
        try:
            await connection.call(agent_id=ids["slow"])
            await connection.expect("ack")
            await connection.send({"type": "cancel", "callId": "call-1"})
            assert await asyncio.to_thread(cancelled.wait, 5)
            await connection.nothing()
            assert client._in_flight == {}
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A call past the concurrency limit answers agent_busy"
async def test_second_call_over_the_limit_answers_agent_busy():
    release = threading.Event()

    def agent(messages):
        release.wait(5)
        return "done"

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="one", concurrency=1)
        )
        try:
            await connection.call(agent_id=ids["one"], call_id="call-1")
            await connection.expect("ack")
            await connection.call(agent_id=ids["one"], call_id="call-2")
            busy = await connection.expect("result")
            assert busy["callId"] == "call-2"
            assert busy["error"]["code"] == "agent_busy"
            release.set()
            first = await connection.expect("result")
            assert first["callId"] == "call-1" and first["output"] == "done"
        finally:
            release.set()
            await asyncio.to_thread(client.stop)


class _InMemoryExporter(SpanExporter):
    def __init__(self) -> None:
        self.spans: list[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        pass


# @scenario "The traceparent of the envelope is adopted before the call"
@pytest.mark.parametrize("style", ["sync", "async"])
async def test_traceparent_is_adopted_before_the_call(style):
    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = trace.get_tracer("test", tracer_provider=provider)

    def sync_agent(messages):
        with tracer.start_as_current_span("agent-work"):
            return "ok"

    async def async_agent(messages):
        with tracer.start_as_current_span("agent-work"):
            return "ok"

    agent = sync_agent if style == "sync" else async_agent
    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="traced")
        )
        try:
            await connection.call(agent_id=ids["traced"], traceparent=TRACEPARENT)
            await connection.expect("ack")
            await connection.expect("result")
        finally:
            await asyncio.to_thread(client.stop)

    assert len(exporter.spans) == 1
    span = exporter.spans[0]
    assert f"{span.context.trace_id:032x}" == REMOTE_TRACE_ID
    assert span.parent is not None
    assert f"{span.parent.span_id:016x}" == REMOTE_SPAN_ID


# @scenario "The spans of a call reach the platform before its result"
async def test_call_exports_the_spans_before_it_sends_the_result(monkeypatch):
    import threading

    flushed = threading.Event()
    timeouts: list[Any] = []

    class Provider:
        def force_flush(self, timeout_millis: int | None = None) -> bool:
            timeouts.append(timeout_millis)
            flushed.set()
            return True

    monkeypatch.setattr(
        client_module.trace_api, "get_tracer_provider", lambda: Provider()
    )

    def agent(messages):
        return "ok"

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="flushing")
        )
        try:
            await connection.call(agent_id=ids["flushing"])
            await connection.expect("ack")
            await connection.expect("result")
            # The result is already in hand, so the export it waited for has
            # to be over. Reading the flag without waiting is what proves the
            # order: a flush started next to the result would still be unset.
            assert flushed.is_set()
        finally:
            await asyncio.to_thread(client.stop)

    assert timeouts == [client_module.SPAN_FLUSH_TIMEOUT_MILLIS]


# @scenario "The spans of a call reach the platform before its result"
async def test_a_flush_that_times_out_is_logged_and_the_call_still_answers(
    monkeypatch, caplog
):
    class Provider:
        def force_flush(self, timeout_millis: int | None = None) -> bool:
            return False

    monkeypatch.setattr(
        client_module.trace_api, "get_tracer_provider", lambda: Provider()
    )

    def agent(messages):
        return "ok"

    with caplog.at_level(logging.DEBUG, logger=client_module.logger.name):
        async with FakePlatform() as platform:
            client, connection, _, ids = await connect(
                platform, ConnectedAgent(agent, name="slow-flush")
            )
            try:
                await connection.call(agent_id=ids["slow-flush"])
                await connection.expect("ack")
                result = await connection.expect("result")
                assert result["output"] == "ok"
            finally:
                await asyncio.to_thread(client.stop)

    assert any("timed out" in record.message for record in caplog.records)


# @scenario "A refused registration warns once, names the fix and disables the client"
@pytest.mark.parametrize(
    "code,meta,expected",
    [
        (
            "project_required",
            {
                "projects": [
                    {"id": "proj_a", "name": "Alpha"},
                    {"id": "proj_b", "name": "Beta"},
                ]
            },
            ["Alpha (proj_a)", "Beta (proj_b)", "LANGWATCH_PROJECT_ID"],
        ),
        ("api_key_invalid", None, ["LANGWATCH_API_KEY"]),
        ("key_type_not_allowed", None, ["project API key", "personal API key"]),
        ("permission_denied", None, ["scenarios:manage"]),
        ("parameters_invalid", None, ["parameters_invalid", "too many parameters"]),
        ("environment_invalid", None, ["environment_invalid", "too many parameters"]),
    ],
)
async def test_refused_warns_once_and_stops_reconnecting(caplog, code, meta, expected):
    caplog.set_level(logging.DEBUG, logger="langwatch.agent")
    agent = echo_agent()
    async with FakePlatform() as platform:
        client = make_client(platform)
        client.register_agent(agent)
        connection = await platform.accept()
        await connection.expect("register")
        frame: dict[str, Any] = {
            "type": "refused",
            "code": code,
            "message": "too many parameters",
        }
        if meta is not None:
            frame["meta"] = meta
        await connection.send(frame)
        await connection.closed.wait()
        thread = client._thread
        assert thread is not None
        await asyncio.to_thread(thread.join, 5)

        assert client.started is False
        with pytest.raises(asyncio.TimeoutError):
            await platform.accept(timeout=0.5)
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1
        assert "not connected to LangWatch" in warnings[0].message
        for text in expected:
            assert text in warnings[0].message
        assert agent([{"role": "user", "content": "hi"}], None) == AgentReply(
            output="free:hi", session={"seen": 1}
        )
        client.register_agent(echo_agent("another"))
        assert client.started is False


# @scenario "An unreachable endpoint warns once and keeps reconnecting silently"
async def test_unreachable_endpoint_warns_once_and_keeps_retrying(caplog):
    caplog.set_level(logging.DEBUG, logger="langwatch.agent")
    async with FakePlatform() as platform:
        port = platform.port
    client = AgentClient(
        api_key="sk-lw-test-key",
        endpoint=f"http://127.0.0.1:{port}",
        should_install_process_hooks=False,
        should_setup_tracing=False,
        backoff_initial=0.02,
        backoff_max=0.05,
    )
    client.register_agent(echo_agent())
    try:
        await asyncio.sleep(0.6)
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        attempts = [
            r for r in caplog.records if "retrying in the background" in r.message
        ]
        assert len(warnings) == 1
        assert f"127.0.0.1:{port}" in warnings[0].message
        assert "retrying in the background" in warnings[0].message
        assert len(attempts) > 3
        assert client.started is True
    finally:
        await asyncio.to_thread(client.stop)


async def test_connectivity_warning_repeats_only_on_state_change_and_after_the_interval(
    caplog,
):
    caplog.set_level(logging.DEBUG, logger="langwatch.agent")
    client = AgentClient(
        api_key="k", endpoint="http://127.0.0.1:1", should_install_process_hooks=False
    )

    client._note_connectivity("unreachable", "down")
    client._note_connectivity("unreachable", "down")
    client._connectivity_state = "connected"
    client._note_connectivity("unreachable", "down again")
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1

    client._connectivity_warned_at = (
        time.monotonic() - client_module.CONNECTIVITY_WARNING_INTERVAL_SECONDS
    )
    client._connectivity_state = "connected"
    client._note_connectivity("unreachable", "down later")
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 2


# @scenario "The client reconnects with backoff after the server drops"
async def test_reconnects_after_the_server_drops():
    async with FakePlatform() as platform:
        client, connection, _, _ = await connect(platform, echo_agent())
        try:
            await connection.close(code=1000)
            dropped_at = time.monotonic()
            again = await platform.accept()
            register = await again.expect("register")
            assert time.monotonic() - dropped_at >= 0.02
            assert register["agents"][0]["name"] == "support-agent"
            await again.registered(register)
            assert client.wait_registered(5.0)

            await again.close(code=1012)
            at_once = await platform.accept(timeout=1.0)
            await at_once.expect("register")
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "In-flight call ids are announced on re-register"
async def test_in_flight_call_ids_are_announced_on_re_register():
    release = threading.Event()

    def agent(messages):
        release.wait(5)
        return "after reconnect"

    async with FakePlatform() as platform:
        client, connection, _, ids = await connect(
            platform, ConnectedAgent(agent, name="slow")
        )
        try:
            await connection.call(agent_id=ids["slow"], call_id="call-7")
            await connection.expect("ack")
            await connection.close(code=1012)

            again = await platform.accept()
            register = await again.expect("register")
            assert register["instance"]["inFlightCallIds"] == ["call-7"]
            await again.registered(register)
            release.set()
            result = await again.expect("result")
            assert (
                result["callId"] == "call-7" and result["output"] == "after reconnect"
            )
        finally:
            release.set()
            await asyncio.to_thread(client.stop)


# @scenario "Deregister is sent on shutdown"
async def test_stop_sends_deregister_before_closing():
    async with FakePlatform() as platform:
        client, connection, _, _ = await connect(platform, echo_agent())
        await asyncio.to_thread(client.stop)
        assert await connection.expect("deregister") == {
            "type": "deregister",
            "protocol": PROTOCOL_VERSION,
        }
        await asyncio.wait_for(connection.closed.wait(), 5)
        assert client.started is False


async def test_signal_handler_deregisters_then_chains_to_the_previous_handler():
    previous_calls: list[Any] = []
    async with FakePlatform() as platform:
        client, connection, _, _ = await connect(platform, echo_agent())
        client._previous_handlers[signal.SIGINT] = lambda signum, frame: (
            previous_calls.append(signum)
        )
        await asyncio.to_thread(client._on_signal, signal.SIGINT, None)
        await connection.expect("deregister")
        assert previous_calls == [signal.SIGINT]
        assert client.started is False


# @scenario "A fork restarts the client in the child"
async def test_after_fork_restarts_the_client_with_a_new_identity():
    async with FakePlatform() as platform:
        client, connection, register, _ = await connect(platform, echo_agent())
        try:
            old_thread = client._thread
            old_id = register["instance"]["id"]
            await asyncio.to_thread(client._after_fork_in_child)
            child = await platform.accept()
            child_register = await child.expect("register")
            assert child_register["instance"]["id"] != old_id
            assert client._thread is not old_thread and client.started
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "serve() blocks until the process is interrupted"
async def test_serve_blocks_and_returns_on_keyboard_interrupt(monkeypatch):
    async with FakePlatform() as platform:
        client, connection, _, _ = await connect(platform, echo_agent())
        monkeypatch.setattr(client_module, "_default_client", client)
        blocked = threading.Event()

        def wait_stopped(*, poll_seconds: float) -> None:
            blocked.set()
            time.sleep(0.2)
            raise KeyboardInterrupt

        monkeypatch.setattr(client, "wait_stopped", wait_stopped)
        started = time.monotonic()
        await asyncio.to_thread(client_module.serve, poll_seconds=0.05)

        assert blocked.is_set()
        assert time.monotonic() - started >= 0.2
        assert await connection.expect("deregister")
        assert client.started is False


async def test_serve_returns_when_the_connection_thread_stops():
    async with FakePlatform() as platform:
        client, connection, _, _ = await connect(platform, echo_agent())
        client_module._default_client = client
        try:
            serving = asyncio.create_task(
                asyncio.to_thread(client_module.serve, poll_seconds=0.05)
            )
            await asyncio.sleep(0.2)
            assert not serving.done()
            await asyncio.to_thread(client.stop)
            await asyncio.wait_for(serving, 5)
        finally:
            client_module._default_client = None


async def test_serve_raises_when_it_cannot_connect(monkeypatch):
    monkeypatch.delenv("LANGWATCH_API_KEY", raising=False)
    client = AgentClient(should_install_process_hooks=False, should_setup_tracing=False)
    client_module._default_client = client
    try:
        with pytest.raises(RuntimeError, match="no function is decorated"):
            client_module.serve()
    finally:
        client_module._default_client = None


# @scenario "The decorator registers the function and keeps it callable"
async def test_connect_agent_starts_the_default_client_when_a_key_is_present(
    monkeypatch,
):
    monkeypatch.setattr(client_module, "ensure_setup", lambda **_: None)
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("LANGWATCH_AGENT_CONNECT", raising=False)
    client_module._reset_default_client_for_tests()
    async with FakePlatform() as platform:
        monkeypatch.setenv("LANGWATCH_API_KEY", "sk-lw-from-env")
        monkeypatch.setenv("LANGWATCH_ENDPOINT", platform.endpoint)
        try:

            @connect_agent(name="from-decorator")
            def agent(messages) -> str:
                return "ok"

            connection = await platform.accept()
            register = await connection.expect("register")
            assert connection.headers["authorization"] == "Bearer sk-lw-from-env"
            assert register["agents"][0]["name"] == "from-decorator"
            assert agent([]) == "ok"
        finally:
            await asyncio.to_thread(client_module._reset_default_client_for_tests)


# @scenario "The deadline of a call is read as epoch milliseconds"
async def test_seconds_until_reads_epoch_milliseconds_and_iso_strings():
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    epoch_left = client_module._seconds_until(now_ms + 30_000)
    assert epoch_left is not None and 29 < epoch_left <= 30

    iso = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    iso_left = client_module._seconds_until(iso)
    assert iso_left is not None and 29 < iso_left <= 30

    assert client_module._seconds_until(None) is None
    assert client_module._seconds_until("not a date") is None


# @scenario "The handshake moves on to the next address when one does not answer"
async def test_connect_tries_the_next_resolved_address_after_a_short_delay(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_connect(url: str, **options: Any) -> str:
        captured["url"] = url
        captured.update(options)
        return "connection"

    monkeypatch.setattr(client_module.websockets, "connect", fake_connect)
    monkeypatch.delenv("LANGWATCH_ENDPOINT", raising=False)
    client = AgentClient(
        api_key="k",
        endpoint="https://app.langwatch.ai",
        should_install_process_hooks=False,
    )
    client._resolve_settings()

    assert client._connect() == "connection"
    assert captured["url"] == "wss://app.langwatch.ai/api/v1/agents/connect"
    assert captured["open_timeout"] == client_module.OPEN_TIMEOUT_SECONDS
    assert (
        captured["happy_eyeballs_delay"] == client_module.HAPPY_EYEBALLS_DELAY_SECONDS
    )
    assert 0 < captured["happy_eyeballs_delay"] < 1


# @scenario "The address delay can be tuned from the environment"
async def test_happy_eyeballs_delay_reads_the_environment_and_keeps_the_default_otherwise(
    monkeypatch,
):
    monkeypatch.delenv(client_module.HAPPY_EYEBALLS_DELAY_VARIABLE, raising=False)
    assert client_module.resolve_happy_eyeballs_delay() == 0.25

    monkeypatch.setenv(client_module.HAPPY_EYEBALLS_DELAY_VARIABLE, "1.5")
    assert client_module.resolve_happy_eyeballs_delay() == 1.5

    monkeypatch.setenv(client_module.HAPPY_EYEBALLS_DELAY_VARIABLE, "0")
    assert client_module.resolve_happy_eyeballs_delay() == 0.0

    # "inf" and "nan" both read as floats, and an infinite delay would stop
    # the handshake from ever trying the next address.
    for bad in ("", "  ", "soon", "-1", "nan", "inf", "-inf", "Infinity"):
        monkeypatch.setenv(client_module.HAPPY_EYEBALLS_DELAY_VARIABLE, bad)
        assert client_module.resolve_happy_eyeballs_delay() == 0.25
