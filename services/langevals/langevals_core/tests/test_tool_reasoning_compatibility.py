"""
Unit tests for the tools-versus-reasoning compatibility applied by langevals'
litellm patch.

The stub stands in for the provider, so every assertion is about the request
that actually leaves langevals. No API keys and no network.

Spec: specs/evaluators/langevals-judge-reasoning-tool-compatibility.feature
"""

import os
from typing import Optional

import litellm
import litellm.cost_calculator
import pytest

from langevals_core.litellm_patch import ToolReasoningConflictError, patch_litellm

# The rejection as the provider words it, captured from a Comparison run whose
# evaluator model resolved to openai/gpt-5.6-sol.
PROVIDER_TOOL_REASONING_REFUSAL = (
    "litellm.BadRequestError: OpenAIException - Function tools with "
    "reasoning_effort are not supported for gpt-5.6-sol in "
    "/v1/chat/completions. To use function tools, use /v1/responses or set "
    "reasoning_effort to 'none'."
)

AFFECTED_MODELS = [
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
]

# Models nobody has observed to need the compatibility. The first three are
# near-misses a pattern match would have swept up; the last two are models
# verified to reject a reasoning effort of "none" outright.
UNVERIFIED_MODELS = [
    "openai/gpt-5.6-sol-pro",
    "azure/gpt-5.6-sol",
    "openai/gpt-5.5-sol",
    "openai/gpt-5.5",
    "openai/gpt-5-mini",
]

VERDICT_TOOL = {
    "type": "function",
    "function": {
        "name": "select_best_verdict",
        "description": "Record the verdict.",
        "parameters": {
            "type": "object",
            "properties": {"winner": {"type": "string"}},
            "required": ["winner"],
        },
    },
}

FORCED_TOOL_CHOICE = {
    "type": "function",
    "function": {"name": "select_best_verdict"},
}


class _Provider:
    """Records the request langevals sends, and answers with what the test
    lined up for it."""

    def __init__(self):
        self.requests: list[dict] = []
        self.refusal: Optional[BaseException] = None

    def __call__(self, *args, **kwargs):
        self.requests.append(kwargs)
        if self.refusal is not None:
            raise self.refusal
        return "verdict response"

    @property
    def last_request(self) -> dict:
        return self.requests[-1]


@pytest.fixture
def provider(monkeypatch):
    """langevals' litellm patch rebuilt over a stub, so a judge request can be
    read exactly as the provider would receive it.

    litellm's module attributes are restored afterwards, so the rest of the
    suite keeps the real client. X_LITELLM_ variables are cleared because the
    patch merges them into every request, and an ambient reasoning effort would
    read here as a caller's explicit choice.
    """
    for key in list(os.environ):
        if key.startswith("X_LITELLM_"):
            monkeypatch.delenv(key)

    originals = (
        litellm.completion,
        litellm.acompletion,
        litellm.embedding,
        litellm.cost_calculator.completion_cost,
    )
    stub = _Provider()
    litellm.completion = stub
    patch_litellm()
    try:
        yield stub
    finally:
        (
            litellm.completion,
            litellm.acompletion,
            litellm.embedding,
            litellm.cost_calculator.completion_cost,
        ) = originals


def judge_request(model: str, **overrides) -> dict:
    """The shape every LLM-as-judge evaluator here sends: a forced call to a
    named function that carries the verdict."""
    request = dict(
        model=model,
        messages=[{"role": "user", "content": "Pick the best reply."}],
        tools=[VERDICT_TOOL],
        tool_choice=FORCED_TOOL_CHOICE,
    )
    request.update(overrides)
    return request


# @scenario "An affected evaluator model disables reasoning by default"
@pytest.mark.parametrize("model", AFFECTED_MODELS)
def test_affected_model_disables_reasoning_by_default(provider, model):
    litellm.completion(**judge_request(model))

    assert provider.last_request["reasoning_effort"] == "none"


# @scenario "The compatibility value is a default that an explicit effort beats"
def test_explicit_reasoning_effort_beats_the_compatibility_default(provider):
    litellm.completion(
        **judge_request("openai/gpt-5.6-sol", reasoning_effort="high")
    )

    assert provider.last_request["reasoning_effort"] == "high"


# @scenario "An unverified evaluator model keeps its reasoning untouched"
@pytest.mark.parametrize("model", UNVERIFIED_MODELS)
def test_unverified_model_keeps_its_reasoning_untouched(provider, model):
    litellm.completion(**judge_request(model))

    assert "reasoning_effort" not in provider.last_request


# @scenario "A request that carries no tools keeps its reasoning untouched"
def test_request_without_tools_keeps_its_reasoning_untouched(provider):
    litellm.completion(
        model="openai/gpt-5.6-sol",
        messages=[{"role": "user", "content": "Summarize this."}],
    )

    assert "reasoning_effort" not in provider.last_request


# @scenario "The function tool the judge asked for reaches the provider unchanged"
def test_forced_function_call_reaches_the_provider_unchanged(provider):
    litellm.completion(**judge_request("openai/gpt-5.6-sol"))

    assert provider.last_request["tools"] == [VERDICT_TOOL]
    assert provider.last_request["tool_choice"] == FORCED_TOOL_CHOICE


# @scenario "A remaining conflict is reported as a configuration problem the user can fix"
def test_remaining_conflict_is_reported_as_a_fixable_configuration_problem(
    provider,
):
    provider.refusal = Exception(PROVIDER_TOOL_REASONING_REFUSAL)

    with pytest.raises(ToolReasoningConflictError) as raised:
        litellm.completion(**judge_request("openai/gpt-5.6-sol-pro"))

    message = str(raised.value)
    assert "openai/gpt-5.6-sol-pro" in message
    assert "reasoning effort" in message
    assert "none" in message
    assert "/v1/responses" not in message
    assert "OpenAIException" not in message


# @scenario "An unrelated provider rejection reaches the caller unchanged"
def test_unrelated_provider_rejection_reaches_the_caller_unchanged(provider):
    refusal = Exception("OpenAIException - context_length_exceeded")
    provider.refusal = refusal

    with pytest.raises(Exception) as raised:
        litellm.completion(**judge_request("openai/gpt-5.6-sol"))

    assert raised.value is refusal


def test_reasoning_rejection_without_tools_reaches_the_caller_unchanged(provider):
    """The conflict is only a conflict when a tool was actually asked for. A
    request that carries none gets the provider's own answer, whatever the
    rejection happens to mention."""
    refusal = Exception(PROVIDER_TOOL_REASONING_REFUSAL)
    provider.refusal = refusal

    with pytest.raises(Exception) as raised:
        litellm.completion(
            model="openai/gpt-5.6-sol",
            messages=[{"role": "user", "content": "Summarize this."}],
        )

    assert raised.value is refusal
