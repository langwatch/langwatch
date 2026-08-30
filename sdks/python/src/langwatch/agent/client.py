"""The connection that carries every connected agent of the process.

One `AgentClient` runs on a daemon thread with its own asyncio loop, opens
an outbound WebSocket to LangWatch, registers the agents and answers the
calls the platform sends. It reconnects with backoff, sends `deregister` on
shutdown and restarts itself in a forked child. Nothing here raises into
customer code: every failure is logged and answered on the socket.

The same frames also travel over HTTP long polling, for a network that
blocks WebSockets: `transport="http"` or `LANGWATCH_AGENT_TRANSPORT=http`
selects it, and a WebSocket upgrade a proxy answers with an HTTP status
falls back to it on its own.
"""

from __future__ import annotations

import asyncio
import atexit
import json
import logging
import os
import random
import signal
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from opentelemetry import context as otel_context
from opentelemetry import propagate

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None  # type: ignore[assignment]

from langwatch.__version__ import __version__
from langwatch.state import get_api_key, get_endpoint, get_instance
from langwatch.utils.initialization import ensure_setup

from .identity import InstanceIdentity, resolve_enabled, resolve_instance_label
from .protocol import (
    CONNECT_PATH,
    MAX_FRAME_BYTES,
    AgentRegistration,
    CallFrame,
    RegisteredFrame,
    ResultFrame,
    SdkInfo,
    ack_frame,
    deregister_frame,
    error_result_frame,
    register_frame,
    result_frame,
)
from .schema import AgentParameterInvalid

if TYPE_CHECKING:
    from .decorator import ConnectedAgent

logger = logging.getLogger("langwatch.agent")

BACKOFF_INITIAL_SECONDS = 1.0
BACKOFF_MAX_SECONDS = 30.0
OPEN_TIMEOUT_SECONDS = 15.0
SHUTDOWN_TIMEOUT_SECONDS = 3.0
GOING_AWAY_CLOSE_CODE = 1012

SDK_INFO: SdkInfo = {"name": "langwatch", "version": __version__, "language": "python"}
USER_AGENT = f"langwatch-python/{__version__}"

CONNECTIVITY_WARNING_INTERVAL_SECONDS = 300.0

TRANSPORTS = ("websocket", "http")
TRANSPORT_VARIABLE = "LANGWATCH_AGENT_TRANSPORT"
INSTANCE_TOKEN_HEADER = "X-Agent-Instance-Token"
# The platform answers a poll inside 25 seconds; the request budget sits
# well above it so a slow proxy does not read as a lost session.
POLL_TIMEOUT_SECONDS = 45.0

_WEBSOCKETS_MAJOR = int(
    str(getattr(websockets, "__version__", "13")).split(".")[0] or 13
)

NOT_CONNECTED = "connect_agent: the agent was not connected to LangWatch"


def resolve_transport(explicit: str | None = None) -> str:
    """The explicit argument, then `LANGWATCH_AGENT_TRANSPORT`, else `websocket`.

    Anything that is not `http` is the WebSocket, which falls back to HTTP on
    its own when the upgrade is refused.
    """
    candidate = explicit if explicit and explicit.strip() else None
    if candidate is None:
        candidate = os.environ.get(TRANSPORT_VARIABLE)
    if candidate is not None and candidate.strip().lower() == "http":
        return "http"
    return "websocket"


def http_url(endpoint: str) -> str:
    """`https://app.langwatch.ai` becomes `https://app.langwatch.ai/api/agents/connect`."""
    return endpoint.strip().rstrip("/") + CONNECT_PATH


def _upgrade_status(error: BaseException) -> int | None:
    """The HTTP status a WebSocket upgrade was answered with, if that is what failed."""
    response = getattr(error, "response", None)
    code = getattr(response, "status_code", None)
    if isinstance(code, int):
        return code
    code = getattr(error, "status_code", None)
    return code if isinstance(code, int) else None


def _json_of(response: httpx.Response) -> dict[str, Any] | None:
    try:
        body = response.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def refusal_advice(code: str, message: str, meta: dict[str, Any] | None) -> str:
    """One line that names the fix for a `refused` frame."""
    if code == "project_required":
        projects = (meta or {}).get("projects") or []
        listed = ", ".join(
            f"{p.get('name') or '?'} ({p.get('id') or '?'})"
            for p in projects
            if isinstance(p, dict)
        )
        return (
            "the API key reaches several projects"
            + (f": {listed}" if listed else "")
            + "; set LANGWATCH_PROJECT_ID to the id of the project to connect to"
        )
    if code == "api_key_invalid":
        return "the API key was not accepted; check LANGWATCH_API_KEY"
    if code == "key_type_not_allowed":
        return (
            "this key type cannot connect agents; use a project API key or a personal API key, "
            "not an ingestion key"
        )
    if code == "permission_denied":
        return "the API key is missing the scenarios:manage permission; use a key that has it"
    if code in ("parameters_invalid", "environment_invalid"):
        return f"the platform refused the registration ({code}): {message}"
    return f"the platform refused the registration ({code}): {message}"


def socket_url(endpoint: str) -> str:
    """`https://app.langwatch.ai` becomes `wss://app.langwatch.ai/api/agents/connect`."""
    parts = urlsplit(endpoint.strip().rstrip("/"))
    scheme = {"https": "wss", "http": "ws", "wss": "wss", "ws": "ws"}.get(
        parts.scheme.lower(), "wss"
    )
    path = parts.path.rstrip("/") + CONNECT_PATH
    return urlunsplit((scheme, parts.netloc, path, "", ""))


def connection_headers(*, api_key: str, project_id: str | None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key}", "User-Agent": USER_AGENT}
    if project_id:
        headers["X-Project-Id"] = project_id
    return headers


def _seconds_until(deadline_at: str | int | float | None) -> float | None:
    """Seconds left until a deadline the platform sends as epoch milliseconds.

    An ISO 8601 string is accepted as well, so an older platform keeps working.
    """
    if deadline_at is None or deadline_at == "":
        return None
    if isinstance(deadline_at, (int, float)):
        return deadline_at / 1000 - datetime.now(timezone.utc).timestamp()
    try:
        deadline = datetime.fromisoformat(deadline_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return (deadline - datetime.now(timezone.utc)).total_seconds()


class AgentClient:
    """The process-wide registry of connected agents and their one socket."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        endpoint: str | None = None,
        project_id: str | None = None,
        instance_label: str | None = None,
        transport: str | None = None,
        backoff_initial: float = BACKOFF_INITIAL_SECONDS,
        backoff_max: float = BACKOFF_MAX_SECONDS,
        should_install_process_hooks: bool = True,
        should_setup_tracing: bool = True,
    ) -> None:
        self._api_key = api_key
        self._endpoint = endpoint
        self._project_id = project_id
        self._instance_label = instance_label
        self._transport = transport
        self._backoff_initial = backoff_initial
        self._backoff_max = backoff_max
        self._should_install_process_hooks = should_install_process_hooks
        self._should_setup_tracing = should_setup_tracing

        self._agents: dict[str, ConnectedAgent] = {}
        self._agents_by_id: dict[str, ConnectedAgent] = {}
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop: asyncio.Event | None = None
        self._socket: Any = None
        self._http: httpx.AsyncClient | None = None
        self._instance_token: str | None = None
        self._poll_task: asyncio.Task[Any] | None = None
        self._session_lost = False
        self._transport_in_use: str | None = None
        self._identity = InstanceIdentity(label=resolve_instance_label(instance_label))
        self._in_flight: dict[str, asyncio.Task[None]] = {}
        self._in_flight_agent: dict[str, str] = {}
        self._pending_results: list[ResultFrame] = []
        self._registered = threading.Event()
        self._hooks_installed = False
        self._previous_handlers: dict[int, Any] = {}
        self._session_registered = False
        self._disabled_reason: str | None = None
        self._startup_warned = False
        self._connectivity_state: str | None = None
        self._connectivity_warned_at: float | None = None
        self.register_count = 0
        self.resolved_api_key = ""
        self.resolved_endpoint = ""
        self.resolved_project_id: str | None = None
        self.resolved_transport = "websocket"

    # ----- registry -----

    @property
    def agents(self) -> list[ConnectedAgent]:
        with self._lock:
            return list(self._agents.values())

    @property
    def identity(self) -> InstanceIdentity:
        return self._identity

    @property
    def started(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def transport(self) -> str:
        """The transport in use: the configured one, or `http` after a refused upgrade."""
        return self._transport_in_use or self.resolved_transport

    def register_agent(self, agent: ConnectedAgent) -> None:
        """Add the agent and start or refresh the connection."""
        with self._lock:
            if agent.key in self._agents and self._agents[agent.key] is not agent:
                logger.warning(
                    "connect_agent: %s was declared twice, the last declaration wins",
                    agent.key,
                )
            self._agents[agent.key] = agent
        if self.started:
            self._call_soon(self._send_register)
            return
        if self._disabled_reason is not None:
            return
        self.start()

    # ----- configuration -----

    def _resolve_settings(self) -> None:
        agents = self.agents
        first = agents[0] if agents else None
        instance = get_instance()
        self.resolved_api_key = (
            self._api_key
            or (first.api_key if first and first.api_key else None)
            or get_api_key()
            or ""
        )
        self.resolved_endpoint = (
            self._endpoint
            or (first.endpoint if first and first.endpoint else None)
            or get_endpoint()
        )
        self.resolved_project_id = (
            self._project_id
            or (first.project_id if first and first.project_id else None)
            or getattr(instance, "project_id", None)
            or os.environ.get("LANGWATCH_PROJECT_ID")
            or None
        )
        if self._identity.label is None:
            label = resolve_instance_label(
                first.instance_label if first and first.instance_label else None
            )
            self._identity.label = label
        self.resolved_transport = resolve_transport(
            self._transport or (first.transport if first else None)
        )
        if self._transport_in_use is None:
            self._transport_in_use = self.resolved_transport

    def _enabled(self) -> bool:
        agents = self.agents
        explicit = next((a.enabled for a in agents if a.enabled is not None), None)
        return resolve_enabled(explicit)

    def why_not_started(self) -> str | None:
        """The reason `start()` did nothing, or None when it can connect."""
        if not self.agents:
            return "no function is decorated with connect_agent"
        if not self._enabled():
            return "the connection is disabled (CI or LANGWATCH_AGENT_CONNECT=0)"
        if self._disabled_reason is not None:
            return self._disabled_reason
        self._resolve_settings()
        if websockets is None and self.resolved_transport == "websocket":
            return "the websockets package is not installed; run pip install websockets"
        if not self.resolved_api_key:
            return "set LANGWATCH_API_KEY, or pass api_key= to connect_agent"
        return None

    def _warn_not_connected(self, reason: str) -> None:
        """One warning per process, then the application continues."""
        if self._startup_warned:
            logger.debug("%s: %s", NOT_CONNECTED, reason)
            return
        self._startup_warned = True
        logger.warning("%s: %s", NOT_CONNECTED, reason)

    # ----- lifecycle -----

    def start(self) -> bool:
        """Start the connection thread once. Returns whether it runs."""
        with self._lock:
            if self.started:
                return True
            reason = self.why_not_started()
            if reason is not None:
                if self._enabled() and self.agents:
                    self._warn_not_connected(reason)
                else:
                    logger.info("connect_agent: not connecting, %s", reason)
                return False
            self._ensure_tracing()
            self._registered.clear()
            self._thread = threading.Thread(
                target=self._thread_main, name="langwatch-agent", daemon=True
            )
            self._thread.start()
            if self._should_install_process_hooks:
                self._install_hooks()
            return True

    def _ensure_tracing(self) -> None:
        """Set the SDK up so the function's spans reach the platform."""
        if not self._should_setup_tracing:
            return
        try:
            ensure_setup(api_key=self.resolved_api_key)
        except Exception as error:
            logger.debug("connect_agent: tracing setup skipped: %s", error)

    def wait_registered(self, timeout: float) -> bool:
        return self._registered.wait(timeout)

    def wait_stopped(self, *, poll_seconds: float = 0.5) -> None:
        """Block until the connection thread ends."""
        thread = self._thread
        while thread is not None and thread.is_alive():
            thread.join(poll_seconds)

    def stop(self, *, timeout: float = SHUTDOWN_TIMEOUT_SECONDS) -> None:
        """Send deregister, close the socket and join the thread."""
        thread = self._thread
        loop = self._loop
        if thread is None or not thread.is_alive() or loop is None:
            return
        try:
            future = asyncio.run_coroutine_threadsafe(self._shutdown(), loop)
            future.result(timeout)
        except Exception as error:
            logger.debug("connect_agent: shutdown did not finish cleanly: %s", error)
        thread.join(timeout)

    def _call_soon(self, coroutine_factory: Callable[[], Any]) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(coroutine_factory(), loop)
        except Exception as error:
            logger.debug("connect_agent: could not schedule on the loop: %s", error)

    # ----- process hooks -----

    def _install_hooks(self) -> None:
        if self._hooks_installed:
            return
        self._hooks_installed = True
        atexit.register(self._on_exit)
        if hasattr(os, "register_at_fork"):
            os.register_at_fork(after_in_child=self._after_fork_in_child)
        if threading.current_thread() is not threading.main_thread():
            return
        for signum in (signal.SIGINT, signal.SIGTERM):
            try:
                self._previous_handlers[signum] = signal.getsignal(signum)
                signal.signal(signum, self._on_signal)
            except (ValueError, OSError) as error:
                logger.debug("connect_agent: signal %s not hooked: %s", signum, error)

    def _uninstall_hooks(self) -> None:
        for signum, previous in self._previous_handlers.items():
            try:
                signal.signal(signum, previous)
            except (ValueError, OSError):
                pass
        self._previous_handlers = {}
        atexit.unregister(self._on_exit)
        self._hooks_installed = False

    def _on_exit(self) -> None:
        self.stop(timeout=SHUTDOWN_TIMEOUT_SECONDS)

    def _on_signal(self, signum: int, frame: Any) -> None:
        self.stop(timeout=SHUTDOWN_TIMEOUT_SECONDS)
        previous = self._previous_handlers.get(signum)
        if callable(previous):
            previous(signum, frame)
        elif previous == signal.SIG_DFL:
            signal.signal(signum, signal.SIG_DFL)
            os.kill(os.getpid(), signum)

    def _after_fork_in_child(self) -> None:
        """The thread does not exist in the child: forget it and start again."""
        was_started = self._thread is not None
        # `fork` copies the lock in whatever state it had. If the loop thread
        # held it at that moment, it arrives here held by a thread that does
        # not exist, and the `start()` below would wait for it forever. The
        # child has one thread at this point, so a new lock is safe.
        self._lock = threading.RLock()
        self._thread = None
        self._loop = None
        self._stop = None
        self._socket = None
        self._http = None
        self._instance_token = None
        self._poll_task = None
        self._session_lost = False
        self._in_flight = {}
        self._in_flight_agent = {}
        self._pending_results = []
        self._registered = threading.Event()
        self._identity = InstanceIdentity(label=self._identity.label)
        if was_started and self.agents:
            self.start()

    # ----- the loop -----

    def _thread_main(self) -> None:
        try:
            asyncio.run(self._run())
        except Exception as error:
            logger.error("connect_agent: connection thread stopped: %s", error)

    async def _run(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._stop = asyncio.Event()
        attempt = 0
        while not self._stop.is_set():
            reconnect_at_once = False
            try:
                reconnect_at_once = await self._session()
                if (
                    self._session_registered
                    and not self._stop.is_set()
                    and not reconnect_at_once
                ):
                    self._note_connectivity(
                        "lost", "the connection to LangWatch dropped"
                    )
            except asyncio.CancelledError:
                raise
            except Exception as error:
                status = _upgrade_status(error)
                if status is not None and self._transport_in_use == "websocket":
                    # A proxy answered the upgrade with a status: the socket
                    # can never open here, and the same frames travel over
                    # plain HTTP.
                    self._transport_in_use = "http"
                    reconnect_at_once = True
                    logger.warning(
                        "connect_agent: the WebSocket upgrade to %s was answered with HTTP %s; "
                        "using the HTTP transport at %s instead",
                        socket_url(self.resolved_endpoint),
                        status,
                        http_url(self.resolved_endpoint),
                    )
                else:
                    self._note_connectivity(
                        "unreachable",
                        f"could not reach {self.resolved_endpoint} ({type(error).__name__}: {error}); "
                        "check LANGWATCH_ENDPOINT and the network",
                    )
            if self._disabled_reason is not None:
                break
            if self._stop.is_set():
                break
            if self._session_registered or reconnect_at_once:
                attempt = 0
            delay = 0.0 if reconnect_at_once else self._backoff(attempt)
            attempt += 1
            logger.debug("connect_agent: reconnecting in %.1fs", delay)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass

    def _note_connectivity(self, state: str, detail: str) -> None:
        """Warn when the state changes, at most once per five minutes.

        Reconnection itself stays silent: the backoff loop keeps trying and
        the next successful registration logs the recovery.
        """
        now = time.monotonic()
        if state == self._connectivity_state:
            logger.debug("connect_agent: %s, retrying in the background", detail)
            return
        self._connectivity_state = state
        if (
            self._connectivity_warned_at is not None
            and now - self._connectivity_warned_at
            < CONNECTIVITY_WARNING_INTERVAL_SECONDS
        ):
            logger.debug("connect_agent: %s, retrying in the background", detail)
            return
        self._connectivity_warned_at = now
        logger.warning(
            "%s: %s; retrying in the background with backoff", NOT_CONNECTED, detail
        )

    def _backoff(self, attempt: int) -> float:
        base = min(self._backoff_max, self._backoff_initial * (2**attempt))
        return min(self._backoff_max, base * random.uniform(0.5, 1.5))

    def _connect(self) -> Any:
        headers = connection_headers(
            api_key=self.resolved_api_key, project_id=self.resolved_project_id
        )
        url = socket_url(self.resolved_endpoint)
        options: dict[str, Any] = {
            "max_size": MAX_FRAME_BYTES,
            "open_timeout": OPEN_TIMEOUT_SECONDS,
        }
        if _WEBSOCKETS_MAJOR >= 13:
            options["additional_headers"] = headers
        else:
            options["extra_headers"] = headers
        if websockets is None:
            raise RuntimeError("the websockets package is not installed")
        return websockets.connect(url, **options)

    async def _session(self) -> bool:
        """One connection, from register to close. Returns True to reconnect at once."""
        self._resolve_settings()
        self._session_registered = False
        if self._transport_in_use == "http":
            return await self._http_session()
        async with self._connect() as socket:
            self._socket = socket
            try:
                await self._send_register()
                async for raw in socket:
                    await self._on_frame(raw)
            finally:
                self._socket = None
                self._registered.clear()
            return socket.close_code == GOING_AWAY_CLOSE_CODE

    # ----- HTTP long polling -----

    def _http_headers(self) -> dict[str, str]:
        headers = connection_headers(
            api_key=self.resolved_api_key, project_id=self.resolved_project_id
        )
        if self._instance_token:
            headers[INSTANCE_TOKEN_HEADER] = self._instance_token
        return headers

    async def _http_session(self) -> bool:
        """One HTTP session: a register, then polls until the session ends.

        Returns True when the platform no longer knows the session, so the
        loop registers again at once.
        """
        base = http_url(self.resolved_endpoint)
        timeout = httpx.Timeout(POLL_TIMEOUT_SECONDS, connect=OPEN_TIMEOUT_SECONDS)
        async with httpx.AsyncClient(timeout=timeout) as http:
            self._http = http
            self._instance_token = None
            self._session_lost = False
            try:
                agents: list[AgentRegistration] = [a.registration() for a in self.agents]
                frame = register_frame(
                    sdk=SDK_INFO,
                    instance=self._identity.to_frame(
                        in_flight_call_ids=list(self._in_flight)
                    ),
                    agents=agents,
                )
                response = await http.post(
                    base + "/register", json=frame, headers=self._http_headers()
                )
                body = _json_of(response)
                answer = body.get("frame") if body else None
                if not isinstance(answer, dict):
                    raise RuntimeError(
                        f"the register request was answered with HTTP {response.status_code}"
                    )
                self.register_count += 1
                token = body.get("instanceToken") if body else None
                if isinstance(token, str) and token:
                    self._instance_token = token
                await self._handle_frame(answer)
                if answer.get("type") != "registered" or not self._instance_token:
                    return False
                return await self._poll_loop(http, base)
            finally:
                self._http = None
                self._instance_token = None
                self._registered.clear()

    async def _poll_loop(self, http: httpx.AsyncClient, base: str) -> bool:
        assert self._stop is not None
        while not self._stop.is_set() and not self._session_lost:
            params = (
                {"inFlight": ",".join(self._in_flight)} if self._in_flight else None
            )
            self._poll_task = asyncio.ensure_future(
                http.get(base + "/poll", params=params, headers=self._http_headers())
            )
            try:
                response = await self._poll_task
            except asyncio.CancelledError:
                if self._stop.is_set() or self._session_lost:
                    return self._session_lost
                raise
            finally:
                self._poll_task = None
            if response.status_code == 410:
                logger.info(
                    "connect_agent: the platform no longer knows this instance, registering again"
                )
                return True
            body = _json_of(response)
            if response.status_code >= 400:
                refused = body.get("frame") if body else None
                if isinstance(refused, dict):
                    await self._handle_frame(refused)
                    return False
                raise RuntimeError(
                    f"the poll was answered with HTTP {response.status_code}"
                )
            for frame in (body or {}).get("frames") or []:
                if isinstance(frame, dict):
                    await self._handle_frame(frame)
        return self._session_lost

    async def _http_post(self, frame: Any) -> bool:
        http = self._http
        if http is None or not self._instance_token:
            return False
        base = http_url(self.resolved_endpoint)
        try:
            response = await http.post(
                base + "/frames",
                json={"frames": [frame]},
                headers=self._http_headers(),
            )
        except Exception as error:
            logger.debug("connect_agent: post failed: %s", error)
            return False
        if response.status_code == 410:
            self._session_lost = True
            if self._poll_task is not None:
                self._poll_task.cancel()
            return False
        if response.status_code >= 400:
            logger.debug(
                "connect_agent: the frames route answered HTTP %s", response.status_code
            )
            return False
        return True

    async def _send(self, frame: Any) -> bool:
        if self._transport_in_use == "http":
            return await self._http_post(frame)
        socket = self._socket
        if socket is None:
            return False
        try:
            await socket.send(json.dumps(frame))
            return True
        except Exception as error:
            logger.debug("connect_agent: send failed: %s", error)
            return False

    async def _send_register(self) -> None:
        agents: list[AgentRegistration] = [a.registration() for a in self.agents]
        frame = register_frame(
            sdk=SDK_INFO,
            instance=self._identity.to_frame(in_flight_call_ids=list(self._in_flight)),
            agents=agents,
        )
        if await self._send(frame):
            self.register_count += 1

    async def _on_frame(self, raw: Any) -> None:
        try:
            frame = json.loads(raw)
        except (TypeError, ValueError):
            logger.debug("connect_agent: dropped a frame that is not JSON")
            return
        if not isinstance(frame, dict):
            return
        await self._handle_frame(frame)

    async def _handle_frame(self, frame: dict[str, Any]) -> None:
        kind = frame.get("type")
        if kind == "registered":
            self._on_registered(frame)  # type: ignore[arg-type]
            for pending in self._pending_results:
                await self._send(pending)
            self._pending_results = []
        elif kind == "refused":
            code = str(frame.get("code") or "agent_register_refused")
            meta = frame.get("meta") if isinstance(frame.get("meta"), dict) else None
            advice = refusal_advice(code, str(frame.get("message") or ""), meta)
            self._disabled_reason = advice
            self._warn_not_connected(advice)
            if self._stop is not None:
                self._stop.set()
            socket = self._socket
            if socket is not None:
                await socket.close()
        elif kind == "call":
            self._on_call(frame)  # type: ignore[arg-type]
        elif kind == "cancel":
            self._on_cancel(str(frame.get("callId") or ""))
        else:
            logger.debug("connect_agent: ignored frame of type %r", kind)

    def _on_registered(self, frame: RegisteredFrame) -> None:
        self._connectivity_state = "connected"
        by_key = {agent.key: agent for agent in self.agents}
        with self._lock:
            self._agents_by_id = {}
            for entry in frame.get("agents") or []:
                key = f"{entry.get('name')}@{entry.get('environment')}"
                agent = by_key.get(key)
                if agent is None:
                    continue
                self._agents_by_id[str(entry.get("id"))] = agent
                for note in entry.get("parameterNotes") or []:
                    logger.info("connect_agent: %s: %s", key, note)
        instance_id = frame.get("instanceId")
        if isinstance(instance_id, str) and instance_id:
            self._identity.id = instance_id
        logger.info(
            "connect_agent: connected%s, %d agent(s) online at %s",
            " over HTTP long polling" if self._transport_in_use == "http" else "",
            len(self._agents_by_id),
            self.resolved_endpoint,
        )
        self._session_registered = True
        self._registered.set()

    # ----- calls -----

    def _in_flight_for(self, agent: ConnectedAgent) -> int:
        return sum(1 for key in self._in_flight_agent.values() if key == agent.key)

    def _on_call(self, frame: CallFrame) -> None:
        call_id = str(frame.get("callId") or "")
        agent = self._agents_by_id.get(str(frame.get("agentId") or ""))
        if agent is None:
            self._schedule_result(
                error_result_frame(
                    call_id=call_id,
                    code="agent_call_failed",
                    message="no connected agent has this id in this process",
                )
            )
            return
        if self._in_flight_for(agent) >= agent.concurrency:
            self._schedule_result(
                error_result_frame(
                    call_id=call_id,
                    code="agent_busy",
                    message=f"{agent.name} already runs {agent.concurrency} call(s)",
                )
            )
            return
        loop = asyncio.get_running_loop()
        task = loop.create_task(self._run_call(agent, frame))
        self._in_flight[call_id] = task
        self._in_flight_agent[call_id] = agent.key

    def _schedule_result(self, frame: ResultFrame) -> None:
        loop = asyncio.get_running_loop()
        loop.create_task(self._deliver(frame))

    def _on_cancel(self, call_id: str) -> None:
        task = self._in_flight.get(call_id)
        if task is not None:
            task.cancel()

    async def _run_call(self, agent: ConnectedAgent, frame: CallFrame) -> None:
        call_id = str(frame.get("callId") or "")
        await self._send(ack_frame(call_id))
        token = None
        traceparent = frame.get("traceparent")
        if isinstance(traceparent, str) and traceparent:
            carrier = {"traceparent": traceparent}
            token = otel_context.attach(propagate.extract(carrier))
        result: ResultFrame | None = None
        started = time.monotonic()
        timeout = agent.timeout
        try:
            call = agent.call_from_frame(frame)
            remaining = _seconds_until(frame.get("deadlineAt"))
            if remaining is not None:
                timeout = max(0.0, min(agent.timeout, remaining))
            reply = await asyncio.wait_for(agent.invoke(call), timeout=timeout)
            result = result_frame(
                call_id=call_id, output=reply.output, session=reply.session
            )
        except asyncio.TimeoutError:
            result = error_result_frame(
                call_id=call_id,
                code="agent_call_timeout",
                message=f"{agent.name} did not answer within {timeout:.0f}s",
            )
        except asyncio.CancelledError:
            logger.info(
                "connect_agent: call %s cancelled after %.1fs",
                call_id,
                time.monotonic() - started,
            )
        except AgentParameterInvalid as error:
            result = error_result_frame(
                call_id=call_id, code=error.code, message=str(error)
            )
        except Exception as error:
            logger.exception("connect_agent: %s raised on call %s", agent.name, call_id)
            result = error_result_frame(
                call_id=call_id,
                code="agent_call_failed",
                message=f"{type(error).__name__}: {error}",
            )
        finally:
            if token is not None:
                otel_context.detach(token)
            self._in_flight.pop(call_id, None)
            self._in_flight_agent.pop(call_id, None)
        if result is not None:
            await self._deliver(result)

    async def _deliver(self, frame: ResultFrame) -> None:
        if not await self._send(frame):
            self._pending_results.append(frame)

    async def _shutdown(self) -> None:
        if self._stop is not None:
            self._stop.set()
        for task in list(self._in_flight.values()):
            task.cancel()
        await self._send(deregister_frame())
        if self._poll_task is not None:
            self._poll_task.cancel()
        socket = self._socket
        if socket is not None:
            try:
                await socket.close()
            except Exception as error:
                logger.debug("connect_agent: close failed: %s", error)


_default_client: AgentClient | None = None
_default_lock = threading.Lock()


def default_client() -> AgentClient:
    """The one client of the process, created on first use."""
    global _default_client
    with _default_lock:
        if _default_client is None:
            _default_client = AgentClient()
        return _default_client


def register(agent: ConnectedAgent) -> None:
    """Register a decorated function with the process-wide client."""
    try:
        default_client().register_agent(agent)
    except Exception as error:
        logger.error("connect_agent: could not register %s: %s", agent.name, error)


def serve(*, poll_seconds: float = 0.5) -> None:
    """Block the calling thread while the agents stay connected.

    For a script whose only job is the agent. A web server keeps the thread
    alive by itself and does not need this. Returns after SIGINT, SIGTERM or
    when the connection thread stops.
    """
    client = default_client()
    if not client.start():
        reason = client.why_not_started() or "unknown"
        raise RuntimeError(f"langwatch.agent.serve(): {reason}")
    try:
        client.wait_stopped(poll_seconds=poll_seconds)
    except KeyboardInterrupt:
        pass
    finally:
        client.stop()


def _reset_default_client_for_tests() -> None:
    global _default_client
    with _default_lock:
        if _default_client is not None:
            _default_client.stop(timeout=1.0)
            _default_client._uninstall_hooks()
        _default_client = None


__all__ = [
    "AgentClient",
    "connection_headers",
    "default_client",
    "http_url",
    "register",
    "resolve_transport",
    "serve",
    "socket_url",
]
