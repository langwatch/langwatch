# The connect_agent decorator: registration, call binding by declared name,
# return coercion and dispatch of sync and async functions.
#
# See specs/python-sdk/agent-decorator.feature

import asyncio
import logging
import threading
from typing import Any, Literal

import pytest
from pydantic import BaseModel

import langwatch
from langwatch.agent import AgentCall, AgentReply, ConnectedAgent, connect_agent
from langwatch.agent import client as client_module
from langwatch.agent.decorator import coerce_reply
from langwatch.agent.schema import AgentParameterInvalid


@pytest.fixture(autouse=True)
def isolated_default_client(monkeypatch):
    """Decoration registers with the default client; keep it off the network."""
    monkeypatch.delenv("LANGWATCH_API_KEY", raising=False)
    monkeypatch.delenv("LANGWATCH_AGENT_CONNECT", raising=False)
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setattr(client_module, "ensure_setup", lambda **_: None)
    client_module._reset_default_client_for_tests()
    yield
    client_module._reset_default_client_for_tests()


def make_call(**overrides: Any) -> AgentCall:
    values: dict[str, Any] = dict(
        messages=[{"role": "user", "content": "hi"}],
        new_messages=[{"role": "user", "content": "hi"}],
        thread_id="thread-1",
        session=None,
        trace_id="4bf92f3577b34da6a3ce929d0e0e4736",
        parameters={},
    )
    values.update(overrides)
    return AgentCall(**values)


def run(coroutine):
    return asyncio.run(coroutine)


# @scenario "The decorator registers the function and keeps it callable"
def test_decorator_registers_the_function_and_keeps_it_callable():
    @connect_agent(name="support-agent", environment="development")
    def support_agent(messages: list[langwatch.Message], plan: str = "free") -> str:
        return f"{plan}:{messages[-1]['content']}"

    registered = client_module.default_client().agents

    assert [a.key for a in registered] == ["support-agent@development"]
    assert support_agent([{"role": "user", "content": "hi"}]) == "free:hi"
    assert support_agent([{"role": "user", "content": "hi"}], plan="pro") == "pro:hi"
    assert support_agent.__name__ == "support_agent"
    assert isinstance(support_agent, ConnectedAgent)


# @scenario "Nothing happens without an API key"
def test_no_api_key_warns_once_and_keeps_the_function_callable(caplog):
    caplog.set_level(logging.DEBUG, logger="langwatch.agent")

    @connect_agent(name="first")
    def first(messages) -> str:
        return "one"

    @connect_agent(name="second")
    def second(messages) -> str:
        return "two"

    client = client_module.default_client()
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]

    assert client.started is False
    assert len(warnings) == 1
    assert "not connected to LangWatch" in warnings[0].message
    assert "set LANGWATCH_API_KEY" in warnings[0].message
    assert first([]) == "one" and second([]) == "two"
    assert {a.name for a in client.agents} == {"first", "second"}


# @scenario "Decoration never raises into the application"
def test_decoration_survives_a_client_that_fails_to_start(monkeypatch):
    def explode(self):
        raise RuntimeError("boom")

    monkeypatch.setattr(client_module.AgentClient, "register_agent", explode)

    @connect_agent(name="fragile")
    def fragile(messages) -> str:
        return "still here"

    assert fragile([]) == "still here"


# @scenario "A missing websockets package warns and disables the connection"
def test_missing_websockets_warns_and_disables(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="langwatch.agent")
    monkeypatch.setenv("LANGWATCH_API_KEY", "sk-lw-test")
    monkeypatch.setattr(client_module, "websockets", None)

    @connect_agent(name="no-sockets")
    def agent(messages) -> str:
        return "ok"

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]

    assert client_module.default_client().started is False
    assert len(warnings) == 1
    assert "pip install websockets" in warnings[0].message
    assert agent([]) == "ok"


# @scenario "The connection is enabled by default and disabled on CI"
def test_ci_disables_the_connection(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="langwatch.agent")
    monkeypatch.setenv("LANGWATCH_API_KEY", "sk-lw-test")
    monkeypatch.setenv("CI", "true")

    @connect_agent(name="on-ci")
    def agent(messages) -> str:
        return "ok"

    client = client_module.default_client()

    assert client.started is False
    assert (
        client.why_not_started() is not None and "disabled" in client.why_not_started()
    )
    assert not [r for r in caplog.records if r.levelno == logging.WARNING]


# @scenario "LANGWATCH_AGENT_CONNECT=0 disables the connection"
def test_connect_variable_zero_disables_even_when_enabled_is_true(monkeypatch):
    monkeypatch.setenv("LANGWATCH_API_KEY", "sk-lw-test")
    monkeypatch.setenv("LANGWATCH_AGENT_CONNECT", "0")

    @connect_agent(name="switched-off", enabled=True)
    def agent(messages) -> str:
        return "ok"

    assert client_module.default_client().started is False


# @scenario "A generator function is refused at decoration"
def test_generator_functions_are_refused():
    with pytest.raises(TypeError, match="streaming is not supported"):

        @connect_agent(name="gen")
        def agent(messages):
            yield "a"

    with pytest.raises(TypeError, match="streaming is not supported"):

        @connect_agent(name="agen")
        async def async_agent(messages):
            yield "a"


# @scenario "Turn fields are passed by declared name only"
def test_turn_fields_are_passed_by_declared_name_only():
    seen: dict[str, Any] = {}

    def agent(messages, thread_id, plan: str = "free"):
        seen.update(messages=messages, thread_id=thread_id, plan=plan)
        return "ok"

    connected = ConnectedAgent(agent, name="a")
    call = make_call(session={"id": "s"}, parameters={"plan": "pro"})

    args, kwargs = connected.bind(call)

    assert args == []
    assert kwargs == {"messages": call.messages, "thread_id": "thread-1", "plan": "pro"}
    assert run(connected.invoke(call)).output == "ok"
    assert seen == {"messages": call.messages, "thread_id": "thread-1", "plan": "pro"}


# @scenario "A function with **kwargs receives every turn field"
def test_kwargs_receives_every_turn_field():
    seen: dict[str, Any] = {}

    def agent(**kwargs):
        seen.update(kwargs)
        return "ok"

    connected = ConnectedAgent(agent, name="a")
    call = make_call(session={"id": "s"})

    run(connected.invoke(call))

    assert seen == {
        "messages": call.messages,
        "new_messages": call.new_messages,
        "thread_id": "thread-1",
        "session": {"id": "s"},
        "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    }


# @scenario "A first parameter annotated AgentCall receives one object"
def test_agent_call_first_parameter_receives_the_object():
    seen: dict[str, Any] = {}

    def agent(call: AgentCall, plan: str = "free"):
        seen["call"] = call
        seen["plan"] = plan
        return "ok"

    connected = ConnectedAgent(agent, name="a")
    call = make_call(parameters={"plan": "pro"})

    run(connected.invoke(call))

    assert seen["call"] is call
    assert seen["call"].parameters == {"plan": "pro"}
    assert seen["call"].thread_id == "thread-1"
    assert seen["plan"] == "pro"


# @scenario "The wrapped function is duck-typed for the scenario library"
def test_call_reads_the_scenario_input_shape():
    class ScenarioInput:
        thread_id = "thread-9"
        messages = [
            {"role": "user", "content": "first"},
            {"role": "user", "content": "second"},
        ]
        new_messages = [{"role": "user", "content": "second"}]

    seen: dict[str, Any] = {}

    @connect_agent(name="duck")
    def agent(messages, new_messages, thread_id) -> str:
        seen.update(messages=messages, new_messages=new_messages, thread_id=thread_id)
        return "reply"

    output = run(agent.call(ScenarioInput()))

    assert output == "reply"
    assert seen == {
        "messages": ScenarioInput.messages,
        "new_messages": ScenarioInput.new_messages,
        "thread_id": "thread-9",
    }


def test_call_accepts_a_dict_input():
    @connect_agent(name="duck-dict")
    def agent(messages) -> str:
        return messages[-1]["content"]

    assert run(agent.call({"messages": [{"role": "user", "content": "hi"}]})) == "hi"


# @scenario "A parameter the platform did not send takes its default"
def test_missing_parameter_takes_its_default_on_invoke():
    def agent(messages, plan: str = "free"):
        return plan

    assert run(ConnectedAgent(agent, name="a").invoke(make_call())).output == "free"


# @scenario "A required parameter the run did not supply is refused before the call"
def test_required_parameter_missing_refuses_before_the_call():
    ran = threading.Event()

    def agent(messages, customer_id: str):
        ran.set()
        return "ok"

    with pytest.raises(AgentParameterInvalid) as raised:
        run(ConnectedAgent(agent, name="a").invoke(make_call()))

    assert raised.value.parameter == "customer_id"
    assert not ran.is_set()


# @scenario "An invalid parameter value is refused before the call"
def test_invalid_parameter_value_refuses_before_the_call():
    ran = threading.Event()

    def agent(messages, model: Literal["gpt-5", "gpt-5-mini"] = "gpt-5-mini"):
        ran.set()
        return "ok"

    with pytest.raises(AgentParameterInvalid):
        run(
            ConnectedAgent(agent, name="a").invoke(
                make_call(parameters={"model": "gpt-3"})
            )
        )

    assert not ran.is_set()


# @scenario "A string return is the output"
def test_string_return_is_the_output():
    assert coerce_reply("hello") == AgentReply(output="hello")


# @scenario "A message or a list of messages is the output"
def test_message_and_message_list_returns_are_the_output():
    message = {"role": "assistant", "content": "hello"}

    assert coerce_reply(message) == AgentReply(output=message)
    assert coerce_reply([message, message]) == AgentReply(output=[message, message])


# @scenario "AgentReply carries output and session"
def test_agent_reply_carries_output_and_session():
    reply = coerce_reply(AgentReply(output="hello", session={"conversation": "c-1"}))

    assert reply == AgentReply(output="hello", session={"conversation": "c-1"})


def test_other_return_shapes_are_coerced():
    class Answer(BaseModel):
        role: str
        content: str

    assert coerce_reply(None) == AgentReply(output="")
    assert coerce_reply(42) == AgentReply(output="42")
    assert coerce_reply(Answer(role="assistant", content="x")) == AgentReply(
        output={"role": "assistant", "content": "x"}
    )


# @scenario "The session is echoed on the next turn of the same thread"
def test_session_reaches_the_function_when_declared():
    seen: dict[str, Any] = {}

    def agent(messages, session):
        seen["session"] = session
        return AgentReply(
            output="ok", session={"turn": (session or {}).get("turn", 0) + 1}
        )

    connected = ConnectedAgent(agent, name="a")
    first = run(connected.invoke(make_call(session=None)))
    second = run(connected.invoke(make_call(session=first.session)))

    assert first.session == {"turn": 1}
    assert seen["session"] == {"turn": 1}
    assert second.session == {"turn": 2}


# @scenario "A sync function runs in a worker thread"
def test_sync_function_runs_in_a_worker_thread():
    seen: dict[str, Any] = {}

    def agent(messages):
        seen["thread"] = threading.current_thread()
        return "ok"

    async def scenario():
        loop_thread = threading.current_thread()
        await ConnectedAgent(agent, name="a").invoke(make_call())
        return loop_thread

    loop_thread = run(scenario())

    assert seen["thread"] is not loop_thread


# @scenario "An async function runs on the connection loop"
def test_async_function_runs_on_the_loop():
    seen: dict[str, Any] = {}

    async def agent(messages):
        seen["loop"] = asyncio.get_running_loop()
        seen["thread"] = threading.current_thread()
        return "ok"

    async def scenario():
        await ConnectedAgent(agent, name="a").invoke(make_call())
        return asyncio.get_running_loop(), threading.current_thread()

    loop, thread = run(scenario())

    assert seen["loop"] is loop
    assert seen["thread"] is thread


def test_registration_frame_carries_the_agent_options():
    def agent(messages, plan: str = "free"):
        return "ok"

    connected = ConnectedAgent(
        agent,
        name="support-agent",
        environment="production",
        description="Answers support questions",
        timeout=900,
        sticky=True,
    )

    assert connected.registration() == {
        "name": "support-agent",
        "environment": "production",
        "description": "Answers support questions",
        "parameters": {
            "type": "object",
            "properties": {"plan": {"type": "string", "default": "free"}},
        },
        "concurrency": 4,
        "timeoutMs": 300000,
        "sticky": True,
    }
    assert ConnectedAgent(agent, name="dev", environment="development").concurrency == 1


def test_langwatch_exports_the_decorator_surface():
    assert langwatch.connect_agent is connect_agent
    assert langwatch.AgentCall is AgentCall
    assert langwatch.AgentReply is AgentReply
    assert langwatch.Param is not None
    assert langwatch.agent.serve is client_module.serve
