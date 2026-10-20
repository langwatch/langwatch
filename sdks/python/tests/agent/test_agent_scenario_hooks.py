# Scenario setup and teardown hooks: what register declares, and how a call of
# each kind is answered on the wire (ADR-180).
#
# See modules/agent/specs/scenario-hooks-protocol.feature

import asyncio
import logging
import time
from typing import Any

import pytest

from langwatch.agent import AgentReply, ConnectedAgent, ScenarioRun, connect_agent
from langwatch.agent import client as client_module
from langwatch.agent.client import AgentClient


@pytest.fixture(autouse=True)
def isolated_default_client(monkeypatch):
    """Decoration registers with the default client; keep it off the network."""
    monkeypatch.delenv("LANGWATCH_API_KEY", raising=False)
    client_module._reset_default_client_for_tests()
    yield
    client_module._reset_default_client_for_tests()


def shop_assistant(**options: Any) -> ConnectedAgent:
    def agent(messages, loyalty_tier: str = "none") -> str:
        return f"{loyalty_tier}:{messages[-1]['content']}"

    return ConnectedAgent(
        agent, name="shop-assistant", environment="development", **options
    )


def call_frame(**overrides: Any) -> dict[str, Any]:
    frame: dict[str, Any] = {
        "type": "call",
        "protocol": 1,
        "callId": "call-1",
        "agentId": "agent_shop",
        "threadId": "thread-1",
        "messages": [{"role": "user", "content": "hi"}],
        "newMessages": [{"role": "user", "content": "hi"}],
        "params": {},
        "session": None,
        "traceparent": None,
        "deadlineAt": None,
        "run": {
            "scenarioRunId": "run-1",
            "scenarioName": "Refund",
            "batchRunId": "batch-1",
        },
    }
    frame.update(overrides)
    return frame


def answer(agent: ConnectedAgent, frame: dict[str, Any]) -> dict[str, Any]:
    """Runs one call through the client and returns the result frame it sends."""
    client = AgentClient(
        api_key="sk-lw-test",
        should_install_process_hooks=False,
        should_setup_tracing=False,
    )
    sent: list[dict[str, Any]] = []

    async def send(frame: dict[str, Any]) -> bool:
        sent.append(frame)
        return True

    async def flush() -> None:
        return None

    client._send = send  # type: ignore[method-assign]
    client._flush_spans = flush  # type: ignore[method-assign]
    asyncio.run(client._run_call(agent, frame))  # type: ignore[arg-type]
    results = [f for f in sent if f["type"] == "result"]
    assert len(results) == 1
    return results[0]


def without_envelope(result: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in result.items() if k not in ("type", "protocol", "callId")}


# @scenario "An agent with both hooks declares both at register"
def test_an_agent_with_both_hooks_declares_both():
    agent = shop_assistant()

    @agent.scenario.setup
    def setup(run):
        return {}

    @agent.scenario.teardown
    def teardown(run, state):
        return None

    assert agent.registration()["hooks"] == {"setup": True, "teardown": True}


# @scenario "An agent with only a teardown declares only that"
def test_an_agent_with_only_a_teardown_declares_only_that():
    agent = shop_assistant()

    @agent.scenario.teardown
    def teardown(run, state):
        return None

    assert agent.registration()["hooks"] == {"setup": False, "teardown": True}


# @scenario "An agent with no hooks declares none"
def test_an_agent_with_no_hooks_declares_none():
    assert shop_assistant().registration()["hooks"] == {
        "setup": False,
        "teardown": False,
    }


# @scenario "Hook parameters merge into the agent's run-parameter schema"
def test_hook_parameters_merge_into_the_run_parameter_schema():
    agent = shop_assistant()

    @agent.scenario.setup
    def setup(run, loyalty_tier: str = "none", refund_amount: float = 49.95):
        return {}

    @agent.scenario.teardown
    def teardown(run, state, loyalty_tier: str = "none"):
        return None

    schema = agent.registration()["parameters"]
    assert list(schema["properties"]) == ["loyalty_tier", "refund_amount"]
    assert schema["properties"]["refund_amount"] == {"type": "number", "default": 49.95}
    assert "required" not in schema


# @scenario "Two hooks that disagree on a parameter type are refused at decoration"
def test_hooks_that_disagree_on_a_parameter_type_are_refused(caplog):
    caplog.set_level(logging.WARNING, logger="langwatch.agent")

    @connect_agent(name="shop-assistant", environment="development")
    def agent(messages) -> str:
        return "ok"

    @agent.scenario.setup
    def setup(run, refund_amount: float = 49.95):
        return {}

    assert [a.key for a in client_module.default_client().agents] == [
        "shop-assistant@development"
    ]

    @agent.scenario.teardown
    def teardown(run, state, refund_amount: str = "49.95"):
        return None

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("refund_amount" in w and "parameters_invalid" in w for w in warnings)
    assert client_module.default_client().agents == []


class FakeSocket:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def running_default_client(monkeypatch) -> tuple[AgentClient, list[dict[str, Any]]]:
    """The default client as if its connection ran: scheduled work runs at once, frames are kept."""
    client = client_module.default_client()
    sent: list[dict[str, Any]] = []

    async def send(frame: dict[str, Any]) -> bool:
        sent.append(frame)
        return True

    monkeypatch.setattr(AgentClient, "started", property(lambda self: True))
    monkeypatch.setattr(client, "_send", send)
    monkeypatch.setattr(client, "_call_soon", lambda factory: asyncio.run(factory()))
    return client, sent


# @scenario "A hook declared after the connection started registers again"
def test_a_hook_declared_after_start_restarts_the_session(monkeypatch):
    @connect_agent(name="shop-assistant", environment="development")
    def agent(messages) -> str:
        return "ok"

    client, _ = running_default_client(monkeypatch)
    socket = FakeSocket()
    client._socket = socket

    @agent.scenario.setup
    def setup(run):
        return {}

    assert socket.closed
    assert client._restart_requested
    assert agent.registration()["hooks"] == {"setup": True, "teardown": False}


# @scenario "A hook declared after the connection started registers again"
def test_a_hook_declared_between_two_polls_ends_the_http_session(monkeypatch):
    @connect_agent(name="shop-assistant", environment="development")
    def agent(messages) -> str:
        return "ok"

    client, _ = running_default_client(monkeypatch)
    client._http = object()  # an HTTP session with no poll in flight

    @agent.scenario.setup
    def setup(run):
        return {}

    assert client._session_lost


# @scenario "A hook declared after the connection started registers again"
def test_a_hook_that_refuses_the_agent_after_start_deregisters(monkeypatch):
    @connect_agent(name="shop-assistant", environment="development")
    def agent(messages, refund_amount: float = 49.95) -> str:
        return "ok"

    _, sent = running_default_client(monkeypatch)

    @agent.scenario.teardown
    def teardown(run, state, refund_amount: str = "49.95"):
        return None

    assert [frame["type"] for frame in sent] == ["deregister"]


def test_a_later_hook_that_resolves_the_conflict_lists_the_agent_again():
    @connect_agent(name="shop-assistant", environment="development")
    def agent(messages, refund_amount: float = 49.95) -> str:
        return "ok"

    @agent.scenario.teardown
    def teardown(run, state, refund_amount: str = "49.95"):
        return None

    assert client_module.default_client().agents == []

    @agent.scenario.teardown
    def teardown_fixed(run, state, refund_amount: float = 49.95):
        return None

    assert agent.refusal is None
    assert [a.key for a in client_module.default_client().agents] == [
        "shop-assistant@development"
    ]


# @scenario "An integer and a number for one parameter merge as a number"
def test_an_integer_and_a_number_merge_as_a_number():
    agent = shop_assistant()

    @agent.scenario.setup
    def setup(run, refund_amount: int = 50):
        return {}

    @agent.scenario.teardown
    def teardown(run, state, refund_amount: float = 50):
        return None

    assert agent.refusal is None
    schema = agent.registration()["parameters"]
    assert schema["properties"]["refund_amount"] == {"type": "number", "default": 50}


# @scenario "Two hooks that give a parameter different defaults are refused at decoration"
def test_hooks_that_disagree_on_a_default_are_refused(caplog):
    caplog.set_level(logging.WARNING, logger="langwatch.agent")

    @connect_agent(name="shop-assistant", environment="development")
    def agent(messages) -> str:
        return "ok"

    @agent.scenario.setup
    def setup(run, loyalty_tier: str = "none"):
        return {}

    @agent.scenario.teardown
    def teardown(run, state, loyalty_tier: str = "gold"):
        return None

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("loyalty_tier" in w and "parameters_invalid" in w for w in warnings)
    assert client_module.default_client().agents == []


# @scenario "Setup is called with the run reference and its own parameters"
def test_setup_receives_the_run_and_its_parameters():
    agent = shop_assistant()
    seen: dict[str, Any] = {}

    @agent.scenario.setup
    def setup(run, loyalty_tier: str = "none", refund_amount: float = 49.95):
        seen.update(run=run, loyalty_tier=loyalty_tier, refund_amount=refund_amount)
        return {"customer_id": "c_1"}

    answer(agent, call_frame(kind="setup", params={"loyalty_tier": "gold"}))

    assert seen == {
        "run": ScenarioRun(
            scenario_run_id="run-1", scenario_name="Refund", batch_run_id="batch-1"
        ),
        "loyalty_tier": "gold",
        "refund_amount": 49.95,
    }


# @scenario "Setup's return value is sent back as the state"
def test_setup_return_is_sent_as_the_state():
    agent = shop_assistant()

    @agent.scenario.setup
    async def setup(run):
        return {"customer_id": "c_1", "order_id": "o_9"}

    result = answer(agent, call_frame(kind="setup"))

    assert without_envelope(result) == {
        "state": {"customer_id": "c_1", "order_id": "o_9"}
    }


# @scenario "A setup that returns nothing sends an empty state"
def test_setup_that_returns_nothing_sends_an_empty_state():
    agent = shop_assistant()

    @agent.scenario.setup
    async def setup(run):
        return None

    result = answer(agent, call_frame(kind="setup"))

    assert without_envelope(result) == {"state": {}}


# @scenario "Teardown receives the state setup returned"
def test_teardown_receives_the_state():
    agent = shop_assistant()
    seen: dict[str, Any] = {}

    @agent.scenario.teardown
    def teardown(run, state, loyalty_tier: str = "none"):
        seen.update(state=state, loyalty_tier=loyalty_tier)

    answer(agent, call_frame(kind="teardown", state={"customer_id": "c_1"}))

    assert seen == {"state": {"customer_id": "c_1"}, "loyalty_tier": "none"}


# @scenario "Teardown's returned object is sent back"
def test_teardown_return_is_sent_back():
    agent = shop_assistant()

    @agent.scenario.teardown
    def teardown(run, state):
        return {"deleted": ["c_1"]}

    result = answer(agent, call_frame(kind="teardown", state={"customer_id": "c_1"}))

    assert without_envelope(result) == {"state": {"deleted": ["c_1"]}}


# @scenario "Teardown that returns nothing sends no state"
def test_teardown_returning_nothing_sends_no_state():
    agent = shop_assistant()

    @agent.scenario.teardown
    def teardown(run, state):
        return None

    result = answer(agent, call_frame(kind="teardown", state={"customer_id": "c_1"}))

    assert without_envelope(result) == {}


# @scenario "A turn receives the state and may update it"
def test_a_turn_receives_the_state_and_may_update_it():
    seen: dict[str, Any] = {}

    def agent(messages, state):
        seen["state"] = state
        return AgentReply(output="refunded", state={**state, "refunded": True})

    connected = ConnectedAgent(agent, name="shop-assistant")
    result = answer(connected, call_frame(state={"order_id": "o_9"}))

    assert seen["state"] == {"order_id": "o_9"}
    assert without_envelope(result) == {
        "output": "refunded",
        "state": {"order_id": "o_9", "refunded": True},
    }


# @scenario "A turn that returns no update leaves the state alone"
def test_a_turn_with_no_update_sends_no_state():
    result = answer(shop_assistant(), call_frame(state={"order_id": "o_9"}))

    assert without_envelope(result) == {"output": "none:hi"}


# @scenario "A call with no kind is a turn"
def test_a_call_with_no_kind_is_a_turn():
    agent = shop_assistant()

    @agent.scenario.setup
    def setup(run):
        raise AssertionError("a call with no kind must not reach setup")

    frame = call_frame(params={"loyalty_tier": "gold"})
    assert "kind" not in frame

    assert without_envelope(answer(agent, frame)) == {"output": "gold:hi"}


# @scenario "A hook call for a hook the agent did not declare is answered with an error"
def test_an_undeclared_hook_is_answered_with_an_error():
    result = answer(shop_assistant(), call_frame(kind="setup"))

    assert result["error"]["code"] == "hook_not_declared"
    assert "output" not in result


# @scenario "A hook that raises is answered with an error"
def test_a_hook_that_raises_is_answered_with_an_error():
    agent = shop_assistant()

    @agent.scenario.setup
    def setup(run):
        raise RuntimeError("database unreachable")

    result = answer(agent, call_frame(kind="setup"))

    assert result["error"]["code"] == "agent_call_failed"
    assert "database unreachable" in result["error"]["message"]
    assert without_envelope(answer(agent, call_frame(kind="turn"))) == {
        "output": "none:hi"
    }


def test_a_setup_runs_under_its_deadline_not_the_turn_timeout():
    agent = shop_assistant(timeout=1)

    @agent.scenario.setup
    async def setup(run):
        await asyncio.sleep(1.3)
        return {"order_id": "42"}

    deadline_at = (time.time() + 5) * 1000
    result = answer(agent, call_frame(kind="setup", deadlineAt=deadline_at))

    assert result.get("state") == {"order_id": "42"}


# @scenario "State over the size cap is refused"
def test_setup_state_over_the_cap_is_refused():
    agent = shop_assistant()

    @agent.scenario.setup
    def setup(run):
        return {"blob": "x" * (64 * 1024)}

    result = answer(agent, call_frame(kind="setup"))

    assert result["error"]["code"] == "agent_payload_too_large"
    assert "state" not in result


# @scenario "A teardown object over the size cap is refused"
def test_teardown_object_over_the_cap_is_refused():
    agent = shop_assistant()

    @agent.scenario.teardown
    def teardown(run, state):
        return {"log": "y" * (64 * 1024)}

    result = answer(agent, call_frame(kind="teardown", state={}))

    assert result["error"]["code"] == "agent_payload_too_large"


# @scenario "State that is not JSON is refused"
def test_state_that_is_not_json_is_refused():
    agent = shop_assistant()

    @agent.scenario.setup
    def setup(run):
        return {"customer": object()}

    result = answer(agent, call_frame(kind="setup"))

    assert result["error"]["code"] == "agent_call_failed"
    assert "state" in result["error"]["message"]
