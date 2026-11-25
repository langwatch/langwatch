# The connection client over HTTP long polling, against a fake platform that
# speaks plain HTTP/1.1 on one port: it answers the register, poll and frames
# routes, and answers a WebSocket upgrade with 403 the way a proxy does.
#
# See specs/python-sdk/agent-decorator.feature

import asyncio
import json
import logging
from typing import Any

import pytest

from langwatch.agent import ConnectedAgent
from langwatch.agent import client as client_module
from langwatch.agent.client import AgentClient, http_url, resolve_transport
from langwatch.agent.protocol import PROTOCOL_VERSION

pytestmark = pytest.mark.asyncio

POLL_WAIT_SECONDS = 0.15


class Request:
    def __init__(
        self, method: str, path: str, headers: dict[str, str], body: bytes
    ) -> None:
        self.method = method
        self.path = path
        self.headers = headers
        self.json: dict[str, Any] | None = json.loads(body) if body else None


class FakeHttpPlatform:
    """A minimal HTTP/1.1 server: keep-alive, Content-Length bodies, no chunking."""

    def __init__(self) -> None:
        self.server: Any = None
        self.port = 0
        self.requests: asyncio.Queue[Request] = asyncio.Queue()
        self.upgrades = 0
        self.poll_status = 200
        self._queued: list[dict[str, Any]] = []
        self._waiting: list[asyncio.Future[list[dict[str, Any]]]] = []
        self._tokens = 0

    async def __aenter__(self) -> "FakeHttpPlatform":
        self.server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_: object) -> None:
        for waiting in self._waiting:
            if not waiting.done():
                waiting.set_result([])
        self.server.close()
        await self.server.wait_closed()

    @property
    def endpoint(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def deliver(self, frame: dict[str, Any]) -> None:
        frame = {"protocol": PROTOCOL_VERSION, **frame}
        while self._waiting:
            waiting = self._waiting.pop(0)
            if not waiting.done():
                waiting.set_result([frame])
                return
        self._queued.append(frame)

    async def expect(self, prefix: str, timeout: float = 5.0) -> Request:
        """The next request whose path starts with `prefix`; others are skipped."""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            request = await asyncio.wait_for(self.requests.get(), max(remaining, 0.01))
            if request.path.startswith(prefix):
                return request

    async def expect_frame(self, kind: str, timeout: float = 5.0) -> Request:
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            request = await asyncio.wait_for(self.requests.get(), max(remaining, 0.01))
            if request.path == "/api/v1/agents/connect/frames" and any(
                f.get("type") == kind for f in (request.json or {}).get("frames", [])
            ):
                return request

    async def _serve(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            while True:
                head = await reader.readuntil(b"\r\n\r\n")
                lines = head.decode().split("\r\n")
                method, path, _ = lines[0].split(" ", 2)
                headers = {}
                for line in lines[1:]:
                    if ":" in line:
                        name, value = line.split(":", 1)
                        headers[name.strip().lower()] = value.strip()
                body = b""
                length = int(headers.get("content-length", "0") or 0)
                if length:
                    body = await reader.readexactly(length)
                request = Request(method, path, headers, body)
                self.requests.put_nowait(request)
                if headers.get("upgrade", "").lower() == "websocket":
                    self.upgrades += 1
                    writer.write(
                        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                    await writer.drain()
                    return
                status, payload = await self._answer(request)
                encoded = json.dumps(payload).encode()
                writer.write(
                    f"HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n"
                    f"Content-Length: {len(encoded)}\r\n\r\n".encode()
                    + encoded
                )
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()

    async def _answer(self, request: Request) -> tuple[int, dict[str, Any]]:
        if request.path == "/api/v1/agents/connect/register":
            register = request.json or {}
            self._tokens += 1
            return 200, {
                "frame": {
                    "type": "registered",
                    "protocol": PROTOCOL_VERSION,
                    "agents": [
                        {
                            "name": a["name"],
                            "environment": a["environment"],
                            "id": f"agent_{a['name']}",
                            "url": f"http://platform/agents/agent_{a['name']}",
                            "parameterNotes": [],
                        }
                        for a in register.get("agents", [])
                    ],
                    "heartbeatIntervalMs": int(POLL_WAIT_SECONDS * 1000),
                    "instanceId": register.get("instance", {}).get("id", ""),
                },
                "instanceToken": f"ait_{self._tokens}",
            }
        if request.path.startswith("/api/v1/agents/connect/poll"):
            if self.poll_status != 200:
                # One refusal only. A second one would make the client register
                # a third time, and which register the next request carries the
                # token of would then depend on how fast the runner is.
                status, self.poll_status = self.poll_status, 200
                return status, {"error": "agent_session_unknown"}
            if self._queued:
                frames, self._queued = self._queued, []
                return 200, {"frames": frames}
            waiting: asyncio.Future[list[dict[str, Any]]] = (
                asyncio.get_running_loop().create_future()
            )
            self._waiting.append(waiting)
            try:
                frames = await asyncio.wait_for(waiting, POLL_WAIT_SECONDS)
            except asyncio.TimeoutError:
                frames = []
            finally:
                if waiting in self._waiting:
                    self._waiting.remove(waiting)
            return 200, {"frames": frames}
        if request.path == "/api/v1/agents/connect/frames":
            return 200, {"accepted": len((request.json or {}).get("frames", []))}
        return 404, {"error": "not found"}


def make_client(platform: FakeHttpPlatform, **options: Any) -> AgentClient:
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


def call_frame(agent_id: str, call_id: str = "call-1") -> dict[str, Any]:
    return {
        "type": "call",
        "callId": call_id,
        "agentId": agent_id,
        "threadId": "thread-1",
        "messages": [{"role": "user", "content": "hi"}],
        "newMessages": [{"role": "user", "content": "hi"}],
        "params": {},
        "session": None,
        "traceparent": None,
        "deadlineAt": 4102444800000,
        "run": {},
    }


def echo_agent(name: str = "support-agent") -> ConnectedAgent:
    def agent(messages):
        return f"echo:{messages[-1]['content']}"

    return ConnectedAgent(agent, name=name, environment="development")


# @scenario "The transport option selects HTTP long polling"
async def test_http_transport_registers_polls_and_answers_by_post():
    async with FakeHttpPlatform() as platform:
        client = make_client(platform, transport="http", project_id="proj_1")
        client.register_agent(echo_agent())
        try:
            register = await platform.expect("/api/v1/agents/connect/register")
            assert register.method == "POST"
            assert register.headers["authorization"] == "Bearer sk-lw-test-key"
            assert register.headers["x-project-id"] == "proj_1"
            assert register.json is not None
            assert register.json["type"] == "register"
            assert register.json["protocol"] == PROTOCOL_VERSION
            assert client.wait_registered(5.0)
            assert client.transport == "http"
            assert platform.upgrades == 0

            poll = await platform.expect("/api/v1/agents/connect/poll")
            assert poll.method == "GET"
            assert poll.headers["x-agent-instance-token"] == "ait_1"
            assert poll.headers["authorization"] == "Bearer sk-lw-test-key"

            platform.deliver(call_frame("agent_support-agent"))
            ack = await platform.expect_frame("ack")
            assert ack.headers["x-agent-instance-token"] == "ait_1"
            assert ack.json == {
                "frames": [
                    {"type": "ack", "protocol": PROTOCOL_VERSION, "callId": "call-1"}
                ]
            }
            result = await platform.expect_frame("result")
            assert result.json == {
                "frames": [
                    {
                        "type": "result",
                        "protocol": PROTOCOL_VERSION,
                        "callId": "call-1",
                        "output": "echo:hi",
                    }
                ]
            }
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "LANGWATCH_AGENT_TRANSPORT selects the transport"
async def test_transport_variable_selects_http(monkeypatch):
    monkeypatch.setenv("LANGWATCH_AGENT_TRANSPORT", "http")
    assert resolve_transport() == "http"
    assert resolve_transport("websocket") == "websocket"
    monkeypatch.delenv("LANGWATCH_AGENT_TRANSPORT")
    assert resolve_transport() == "websocket"
    assert resolve_transport("auto") == "websocket"
    assert http_url("https://app.langwatch.ai/") == (
        "https://app.langwatch.ai/api/v1/agents/connect"
    )

    monkeypatch.setenv("LANGWATCH_AGENT_TRANSPORT", "http")
    async with FakeHttpPlatform() as platform:
        client = make_client(platform)
        client.register_agent(echo_agent())
        try:
            await platform.expect("/api/v1/agents/connect/register")
            assert client.wait_registered(5.0)
            assert client.transport == "http"
            assert platform.upgrades == 0
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A refused WebSocket upgrade falls back to HTTP with one warning"
async def test_refused_upgrade_falls_back_to_http_with_one_warning(caplog):
    caplog.set_level(logging.INFO, logger="langwatch.agent")
    async with FakeHttpPlatform() as platform:
        client = make_client(platform)
        client.register_agent(echo_agent())
        try:
            register = await platform.expect("/api/v1/agents/connect/register")
            assert register.method == "POST"
            assert client.wait_registered(5.0)
            assert platform.upgrades == 1
            assert client.transport == "http"
            warnings = [
                r.getMessage()
                for r in caplog.records
                if r.levelno == logging.WARNING and "HTTP 403" in r.getMessage()
            ]
            assert len(warnings) == 1
            assert "using the HTTP transport" in warnings[0]
            assert not any(
                client_module.NOT_CONNECTED in r.getMessage() for r in caplog.records
            )
        finally:
            await asyncio.to_thread(client.stop)


# @scenario "A poll that answers session unknown registers again"
async def test_session_unknown_registers_again_with_in_flight_ids():
    import threading

    release = threading.Event()

    def slow(messages):
        release.wait(5)
        return "late"

    async with FakeHttpPlatform() as platform:
        client = make_client(platform, transport="http")
        client.register_agent(ConnectedAgent(slow, name="slow", environment="development"))
        try:
            await platform.expect("/api/v1/agents/connect/register")
            assert client.wait_registered(5.0)
            platform.deliver(call_frame("agent_slow", "call-slow"))
            await platform.expect_frame("ack")

            platform.poll_status = 410
            again = await platform.expect("/api/v1/agents/connect/register")
            assert again.json is not None
            assert again.json["instance"]["inFlightCallIds"] == ["call-slow"]
            release.set()
            result = await platform.expect_frame("result")
            assert result.headers["x-agent-instance-token"] == "ait_2"
        finally:
            release.set()
            await asyncio.to_thread(client.stop)


# @scenario "Deregister is posted on shutdown over HTTP"
async def test_stop_posts_deregister_over_http():
    async with FakeHttpPlatform() as platform:
        client = make_client(platform, transport="http")
        client.register_agent(echo_agent())
        try:
            await platform.expect("/api/v1/agents/connect/register")
            assert client.wait_registered(5.0)
            await platform.expect("/api/v1/agents/connect/poll")
        finally:
            await asyncio.to_thread(client.stop)
        deregister = await platform.expect_frame("deregister")
        assert deregister.json == {
            "frames": [{"type": "deregister", "protocol": PROTOCOL_VERSION}]
        }
        assert not client.started
