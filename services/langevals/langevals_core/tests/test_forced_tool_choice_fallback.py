"""The forced tool_choice fallback in the litellm patch, and the reader that
checks the judge called its function. Provider stubbed, no keys or network.

Spec: specs/evaluators/langevals-judge-reasoning-tool-compatibility.feature
"""

import json
import os
from types import SimpleNamespace
from typing import Optional

import litellm
import pytest

from langevals_core import litellm_patch
from langevals_core.litellm_patch import patch_litellm
from langevals_core.tool_calls import (
    JudgeAnswerError,
    read_boolean,
    read_tool_call_arguments,
)

# Captured from bedrock/global.anthropic.claude-opus-5-5, which refuses a
# forced tool_choice on every call, reasoning or not.
BEDROCK_FORCED_TOOL_REFUSAL = (
    'litellm.BadRequestError: BedrockException - {"message":"The model returned '
    'the following errors: tool_choice: type \\"tool\\" and \\"any\\" are not '
    'supported for this model."}'
)

# Anthropic's wording when thinking is on and the tool_choice forces a tool.
THINKING_FORCED_TOOL_REFUSAL = (
    "litellm.BadRequestError: AnthropicException - Thinking may not be enabled "
    "when tool_choice forces tool use."
)

MODEL = "bedrock/global.anthropic.claude-opus-5-5"

VERDICT_TOOL = {
    "type": "function",
    "function": {
        "name": "evaluation",
        "parameters": {
            "type": "object",
            "properties": {
                "reasoning": {"type": "string"},
                "result": {"type": "boolean"},
            },
            "required": ["reasoning", "result"],
        },
    },
}

FORCED = {"type": "function", "function": {"name": "evaluation"}}


def tool_response(name: str = "evaluation", arguments: str = '{"reasoning": "r", "result": false}'):
    call = SimpleNamespace(function=SimpleNamespace(name=name, arguments=arguments))
    message = SimpleNamespace(tool_calls=[call], content=None)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="tool_calls")])


def prose_response(text: str = "The answer is false.", finish_reason: str = "stop"):
    message = SimpleNamespace(tool_calls=None, content=text)
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish_reason)])


class _Provider:
    """Refuses forced tool_choice requests while `refusal` is set, and answers
    every other request with the next queued response."""

    def __init__(self):
        self.requests: list[dict] = []
        self.refusal: Optional[BaseException] = None
        self.answers: list = []

    def __call__(self, *args, **kwargs):
        return self._respond(kwargs)

    async def acall(self, *args, **kwargs):
        return self._respond(kwargs)

    def _respond(self, kwargs: dict):
        self.requests.append(kwargs)
        if self.refusal is not None and isinstance(kwargs.get("tool_choice"), dict):
            raise self.refusal
        return self.answers.pop(0) if self.answers else tool_response()


@pytest.fixture
def provider(monkeypatch):
    for key in list(os.environ):
        if key.startswith("X_LITELLM_"):
            monkeypatch.delenv(key)
    patch_litellm()
    stub = _Provider()
    monkeypatch.setitem(litellm_patch.originals, "completion", stub)
    monkeypatch.setitem(litellm_patch.originals, "acompletion", stub.acall)
    monkeypatch.setattr(litellm_patch, "forced_tool_choice_refusers", set())
    return stub


def judge_request(**overrides) -> dict:
    request = dict(
        model=MODEL,
        messages=[{"role": "user", "content": "Judge this."}],
        tools=[VERDICT_TOOL],
        tool_choice=FORCED,
    )
    request.update(overrides)
    return request


# @scenario "A judge reaches a verdict on a model that refuses a forced function call"
@pytest.mark.parametrize("refusal", [BEDROCK_FORCED_TOOL_REFUSAL, THINKING_FORCED_TOOL_REFUSAL])
def test_refused_forced_tool_choice_is_retried_with_auto(provider, refusal):
    provider.refusal = Exception(refusal)

    response = litellm.completion(**judge_request())

    assert [r["tool_choice"] for r in provider.requests] == [FORCED, "auto"]
    assert provider.requests[1]["messages"] == judge_request()["messages"]
    assert read_tool_call_arguments(response, "evaluation", ["result"])["result"] is False


# @scenario "A judge reaches a verdict on a model that refuses a forced function call"
@pytest.mark.anyio
async def test_refused_forced_tool_choice_is_retried_with_auto_when_awaited(provider):
    provider.refusal = Exception(BEDROCK_FORCED_TOOL_REFUSAL)

    response = await litellm.acompletion(**judge_request())

    assert [r["tool_choice"] for r in provider.requests] == [FORCED, "auto"]
    assert read_tool_call_arguments(response, "evaluation", ["result"])["result"] is False


# @scenario "A model seen refusing a forced function call is asked with auto from then on"
def test_known_refuser_skips_the_forced_attempt(provider):
    provider.refusal = Exception(BEDROCK_FORCED_TOOL_REFUSAL)
    litellm.completion(**judge_request())
    provider.requests.clear()

    litellm.completion(**judge_request())

    assert [r["tool_choice"] for r in provider.requests] == ["auto"]


# @scenario "A judge that skips its function under auto is reminded once"
def test_answer_without_the_function_gets_one_reminder(provider):
    provider.refusal = Exception(BEDROCK_FORCED_TOOL_REFUSAL)
    provider.answers = [prose_response(), tool_response()]

    response = litellm.completion(**judge_request())

    assert [r["tool_choice"] for r in provider.requests] == [FORCED, "auto", "auto"]
    reminder = provider.requests[2]["messages"][-1]
    assert reminder["role"] == "user"
    assert "`evaluation`" in reminder["content"]
    assert read_tool_call_arguments(response, "evaluation", ["result"])["result"] is False


# @scenario "A judge that never calls its function fails with a clear error"
def test_judge_that_never_calls_the_function_fails_clearly(provider):
    provider.refusal = Exception(BEDROCK_FORCED_TOOL_REFUSAL)
    provider.answers = [prose_response(), prose_response()]

    response = litellm.completion(**judge_request())

    assert len(provider.requests) == 3
    with pytest.raises(JudgeAnswerError) as raised:
        read_tool_call_arguments(response, "evaluation", ["result"], model=MODEL)
    assert MODEL in str(raised.value)
    assert "without calling the function" in str(raised.value)


# @scenario "A refusal that is not about the forced function call reaches the caller untouched"
@pytest.mark.parametrize(
    "request_overrides, refusal",
    [
        ({}, "litellm.BadRequestError: prompt is too long"),
        ({"tool_choice": "auto"}, BEDROCK_FORCED_TOOL_REFUSAL),
        ({"tools": None, "tool_choice": None}, BEDROCK_FORCED_TOOL_REFUSAL),
    ],
)
def test_unrelated_refusal_reaches_the_caller(provider, request_overrides, refusal, monkeypatch):
    error = Exception(refusal)

    def always_refuse(*args, **kwargs):
        provider.requests.append(kwargs)
        raise error

    monkeypatch.setitem(litellm_patch.originals, "completion", always_refuse)

    with pytest.raises(Exception) as raised:
        litellm.completion(**judge_request(**request_overrides))

    assert raised.value is error
    assert len(provider.requests) == 1


@pytest.mark.parametrize(
    "response, problem",
    [
        (SimpleNamespace(choices=[]), "returned no answer"),
        (prose_response(), "without calling the function"),
        (prose_response("", finish_reason="content_filter"), "content filter"),
        (tool_response(name="other"), "without calling the function"),
        (tool_response(arguments="{not json"), "not valid JSON"),
        (tool_response(arguments="[1]"), "not an object"),
        (tool_response(arguments=json.dumps({"reasoning": "r"})), "result"),
    ],
)
def test_reader_names_what_is_wrong_with_the_answer(response, problem):
    with pytest.raises(JudgeAnswerError) as raised:
        read_tool_call_arguments(response, "evaluation", ["reasoning", "result"])

    assert problem in str(raised.value)


@pytest.mark.parametrize(
    "value, expected",
    [(True, True), (False, False), ("true", True), (" False ", False), ("yes", None), (1, None)],
)
def test_read_boolean(value, expected):
    assert read_boolean(value) is expected
