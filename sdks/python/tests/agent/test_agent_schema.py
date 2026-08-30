# Signature analysis of connect_agent: turn fields, run parameters and the
# JSON Schema the register frame carries.
#
# See specs/python-sdk/agent-decorator.feature

import enum
from typing import Annotated, Any, Literal

import pytest
from pydantic import BaseModel

from langwatch.agent import AgentCall, AgentParameterInvalid, Param
from langwatch.agent.schema import MISSING, TURN_FIELDS, analyze_signature


def analyze(func, **kwargs):
    return analyze_signature(func, agent_call_type=AgentCall, **kwargs)


class Tone(enum.Enum):
    FORMAL = "formal"
    CASUAL = "casual"


class Profile(BaseModel):
    country: str
    age: int


# @scenario "Scalar annotations become typed parameters"
def test_scalar_annotations_become_typed_properties():
    def agent(
        messages,
        plan: str = "free",
        retries: int = 3,
        temperature: float = 0.2,
        verbose: bool = False,
    ):
        return ""

    schema = analyze(agent).json_schema()

    assert schema["type"] == "object"
    assert schema["properties"]["plan"] == {"type": "string", "default": "free"}
    assert schema["properties"]["retries"] == {"type": "integer", "default": 3}
    assert schema["properties"]["temperature"] == {"type": "number", "default": 0.2}
    assert schema["properties"]["verbose"] == {"type": "boolean", "default": False}
    assert "required" not in schema


# @scenario "Literal and Enum annotations become a closed option list"
def test_literal_and_enum_become_enum_options():
    def agent(
        messages,
        model: Literal["gpt-5", "gpt-5-mini"] = "gpt-5-mini",
        tone: Tone = Tone.FORMAL,
    ):
        return ""

    properties = analyze(agent).json_schema()["properties"]

    assert properties["model"] == {
        "type": "string",
        "enum": ["gpt-5", "gpt-5-mini"],
        "default": "gpt-5-mini",
    }
    assert properties["tone"] == {
        "type": "string",
        "enum": ["formal", "casual"],
        "default": "formal",
    }


# @scenario "Annotated with Param adds description and options"
def test_annotated_param_adds_description_and_options():
    def agent(
        messages,
        region: Annotated[
            str, Param(description="Where the customer is", options=["eu", "us"])
        ] = "eu",
        note: Annotated[str, Param(description="Free text")] = "",
    ):
        return ""

    properties = analyze(agent).json_schema()["properties"]

    assert properties["region"] == {
        "type": "string",
        "enum": ["eu", "us"],
        "description": "Where the customer is",
        "default": "eu",
    }
    assert properties["note"] == {
        "type": "string",
        "description": "Free text",
        "default": "",
    }
    assert not hasattr(Param(), "secret")


# @scenario "Optional annotations are typed by their inner type and never required"
def test_optional_annotation_uses_the_inner_type():
    def agent(messages, max_tools: int | None = None, label: "int | None" = None):
        return ""

    schema = analyze(agent).json_schema()

    assert schema["properties"]["max_tools"] == {"type": "integer", "default": None}
    assert schema["properties"]["label"] == {"type": "integer", "default": None}
    assert "required" not in schema


# @scenario "A parameter with no default is required"
def test_parameter_without_default_is_required():
    def agent(messages, customer_id: str, plan: str = "free"):
        return ""

    schema = analyze(agent).json_schema()

    assert schema["required"] == ["customer_id"]
    assert schema["properties"]["customer_id"] == {"type": "string"}


# @scenario "An unsupported annotation falls back to the pydantic schema"
def test_unsupported_annotation_falls_back_to_pydantic_schema():
    def agent(
        messages, profile: Profile = Profile(country="nl", age=30), tags: list[str] = []
    ):
        return ""

    properties = analyze(agent).json_schema()["properties"]

    assert properties["profile"]["type"] == "object"
    assert set(properties["profile"]["properties"]) == {"country", "age"}
    assert properties["profile"]["default"] == {"country": "nl", "age": 30}
    assert properties["tags"] == {
        "type": "array",
        "items": {"type": "string"},
        "default": [],
    }


# @scenario "Turn field names are never run parameters"
def test_turn_fields_are_never_parameters():
    def agent(
        messages,
        new_messages,
        thread_id: str,
        session=None,
        trace_id: str = "",
        plan: str = "free",
    ):
        return ""

    signature = analyze(agent)

    assert signature.turn_fields == [
        "messages",
        "new_messages",
        "thread_id",
        "session",
        "trace_id",
    ]
    assert list(signature.parameters) == ["plan"]
    assert set(TURN_FIELDS) == {
        "messages",
        "new_messages",
        "thread_id",
        "session",
        "trace_id",
    }


# @scenario "A function with **kwargs receives every turn field"
def test_kwargs_is_detected_and_not_a_parameter():
    def agent(**kwargs):
        return ""

    signature = analyze(agent)

    assert signature.has_kwargs is True
    assert signature.parameters == {}


# @scenario "A first parameter annotated AgentCall receives one object"
def test_agent_call_first_parameter_is_detected():
    def agent(call: AgentCall, plan: str = "free"):
        return ""

    signature = analyze(agent)

    assert signature.call_parameter == "call"
    assert list(signature.parameters) == ["plan"]


def test_agent_call_as_a_string_annotation_is_detected():
    def agent(call: "AgentCall"):
        return ""

    assert analyze(agent).call_parameter == "call"


# @scenario "An explicit parameters argument overrides reflection"
def test_explicit_parameters_override_reflection():
    def agent(messages, ignored: str = "x"):
        return ""

    schema = analyze(
        agent,
        parameters={
            "model": {"options": ["gpt-5", "gpt-5-mini"], "default": "gpt-5-mini"},
            "plan": {"default": "free", "description": "Customer plan"},
            "max_tools": {"type": "integer", "default": 5},
            "customer_id": {"type": "string"},
        },
    ).json_schema()

    assert "ignored" not in schema["properties"]
    assert schema["properties"]["model"] == {
        "type": "string",
        "enum": ["gpt-5", "gpt-5-mini"],
        "default": "gpt-5-mini",
    }
    assert schema["properties"]["plan"] == {
        "type": "string",
        "description": "Customer plan",
        "default": "free",
    }
    assert schema["properties"]["max_tools"] == {"type": "integer", "default": 5}
    assert schema["required"] == ["customer_id"]


def test_explicit_json_schema_is_accepted_as_is():
    def agent(messages):
        return ""

    schema = analyze(
        agent,
        parameters={
            "type": "object",
            "properties": {
                "plan": {"type": "string", "default": "free"},
                "customer_id": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["customer_id"],
        },
    ).json_schema()

    assert schema["required"] == ["customer_id"]
    assert schema["properties"]["plan"] == {"type": "string", "default": "free"}
    assert schema["properties"]["notes"] == {"type": "string"}
    assert "notes" not in schema["required"]


# @scenario "A parameter the platform did not send takes its default"
def test_missing_parameter_takes_its_default():
    def agent(messages, plan: str = "free", tone: Tone = Tone.CASUAL):
        return ""

    resolved = analyze(agent).resolve_parameters({})

    assert resolved == {"plan": "free", "tone": Tone.CASUAL}


# @scenario "A required parameter the run did not supply is refused before the call"
def test_missing_required_parameter_is_refused():
    def agent(messages, customer_id: str):
        return ""

    with pytest.raises(AgentParameterInvalid) as raised:
        analyze(agent).resolve_parameters({})

    assert raised.value.parameter == "customer_id"
    assert raised.value.code == "agent_parameter_invalid"
    assert "customer_id" in str(raised.value)


# @scenario "An invalid parameter value is refused before the call"
def test_invalid_value_is_refused():
    def agent(messages, retries: int = 3):
        return ""

    with pytest.raises(AgentParameterInvalid) as raised:
        analyze(agent).resolve_parameters({"retries": "many"})

    assert raised.value.parameter == "retries"


def test_values_are_coerced_by_the_annotation():
    def agent(
        messages, retries: int = 3, tone: Tone = Tone.FORMAL, verbose: bool = False
    ):
        return ""

    resolved = analyze(agent).resolve_parameters(
        {"retries": "5", "tone": "casual", "verbose": "true"}
    )

    assert resolved == {"retries": 5, "tone": Tone.CASUAL, "verbose": True}


# @scenario "A value outside a closed option list is refused before the call"
def test_value_outside_literal_options_is_refused():
    def agent(messages, model: Literal["gpt-5", "gpt-5-mini"] = "gpt-5-mini"):
        return ""

    with pytest.raises(AgentParameterInvalid) as raised:
        analyze(agent).resolve_parameters({"model": "gpt-3"})

    assert raised.value.parameter == "model"


def test_value_outside_param_options_is_refused():
    def agent(messages, region: Annotated[str, Param(options=["eu", "us"])] = "eu"):
        return ""

    with pytest.raises(AgentParameterInvalid):
        analyze(agent).resolve_parameters({"region": "mars"})
    assert analyze(agent).resolve_parameters({"region": "us"}) == {"region": "us"}


def test_unknown_parameters_sent_by_the_platform_are_dropped():
    def agent(messages, plan: str = "free"):
        return ""

    assert analyze(agent).resolve_parameters({"plan": "pro", "other": 1}) == {
        "plan": "pro"
    }


def test_parameter_without_annotation_is_text():
    def agent(messages, note="hi"):
        return ""

    properties = analyze(agent).json_schema()["properties"]

    assert properties["note"] == {"type": "string", "default": "hi"}
    assert analyze(agent).resolve_parameters({"note": 5})["note"] == 5
    assert analyze(agent).parameters["note"].default is not MISSING


def test_dict_annotation_falls_back_to_pydantic_schema():
    def agent(messages, extra: dict[str, Any] = {}):
        return ""

    assert analyze(agent).json_schema()["properties"]["extra"]["type"] == "object"
