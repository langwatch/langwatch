"""Offline regression tests for topic naming with reasoning models."""

import json
from types import SimpleNamespace
from typing import Any

import pytest
from langevals_topic_clustering import topic_naming
from litellm.exceptions import UnsupportedParamsError
from tenacity import stop_after_attempt, wait_none


def _response(arguments: dict[str, str]) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    tool_calls=[
                        SimpleNamespace(
                            function=SimpleNamespace(arguments=json.dumps(arguments))
                        )
                    ]
                )
            )
        ]
    )


def _stub_completion(
    monkeypatch: pytest.MonkeyPatch,
    calls: list[dict[str, Any]],
    arguments: dict[str, str],
) -> None:
    monkeypatch.setattr(topic_naming, "cost_of", lambda _: 0.0)

    def completion(**kwargs: Any) -> SimpleNamespace:
        calls.append(kwargs)
        return _response(arguments)

    monkeypatch.setattr(topic_naming.litellm, "completion", completion)


# @scenario "A reasoning naming model is called at temperature one"
def test_reasoning_model_gets_temperature_one(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    _stub_completion(monkeypatch, calls, {"topic_0": "Alpha", "topic_1": "Beta"})

    params = {"model": "openai/gpt-5-mini", "api_base": "https://example.invalid/v1"}
    names, _ = topic_naming.generate_topic_names(params, [["a", "b"], ["c", "d"]])

    assert names == ["Alpha", "Beta"]
    assert calls[0]["temperature"] == 1.0
    assert calls[0]["model"] == params["model"]
    assert calls[0]["api_base"] == params["api_base"]


# @scenario "Other naming models stay at temperature zero"
def test_other_models_keep_temperature_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    _stub_completion(monkeypatch, calls, {"topic_0": "Alpha", "topic_1": "Beta"})

    names, _ = topic_naming.generate_topic_names(
        {"model": "openai/gpt-4o-mini"}, [["a", "b"], ["c", "d"]]
    )

    assert names == ["Alpha", "Beta"]
    assert calls[0]["temperature"] == 0.0


# @scenario "Disambiguation uses the same temperature rule"
def test_disambiguation_uses_same_temperature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    _stub_completion(monkeypatch, calls, {"topic_a": "Alpha", "topic_b": "Beta"})

    first, second, _ = topic_naming.improve_name_between_two_topics(
        {"model": "openai/gpt-5-mini"},
        "Same",
        "Same too",
        ["a", "b"],
        ["c", "d"],
    )

    assert (first, second) == ("Alpha", "Beta")
    assert calls[0]["temperature"] == 1.0


# @scenario "Another reasoning model refusing temperature is retried once"
def test_other_reasoning_model_retries_without_temperature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(topic_naming, "cost_of", lambda _: 0.0)
    monkeypatch.setattr(topic_naming.generate_topic_names.retry, "wait", wait_none())
    monkeypatch.setattr(
        topic_naming.generate_topic_names.retry, "stop", stop_after_attempt(1)
    )

    def completion(**kwargs: Any) -> SimpleNamespace:
        calls.append(kwargs)
        if len(calls) == 1:
            raise UnsupportedParamsError(
                message="o3 doesn't support temperature=0.0 while reasoning is active",
                llm_provider="openai",
                model="openai/o3",
            )
        return _response({"topic_0": "Alpha", "topic_1": "Beta"})

    monkeypatch.setattr(topic_naming.litellm, "completion", completion)

    names, _ = topic_naming.generate_topic_names(
        {"model": "openai/o3"}, [["a", "b"], ["c", "d"]]
    )

    assert names == ["Alpha", "Beta"]
    assert calls[0]["temperature"] == 0.0
    assert "temperature" not in calls[1]
    assert calls[1]["model"] == "openai/o3"


def test_other_unsupported_params_are_not_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(topic_naming, "cost_of", lambda _: 0.0)
    monkeypatch.setattr(topic_naming.generate_topic_names.retry, "wait", wait_none())
    monkeypatch.setattr(
        topic_naming.generate_topic_names.retry, "stop", stop_after_attempt(1)
    )

    def completion(**kwargs: Any) -> SimpleNamespace:
        calls.append(kwargs)
        raise UnsupportedParamsError(
            message="o3 does not support these tools",
            llm_provider="openai",
            model="openai/o3",
        )

    monkeypatch.setattr(topic_naming.litellm, "completion", completion)

    with pytest.raises(ValueError, match="Failed to generate topic names"):
        topic_naming.generate_topic_names({"model": "openai/o3"}, [["a", "b"]])

    assert len(calls) == 1
