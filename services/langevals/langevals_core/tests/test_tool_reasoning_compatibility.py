"""
Unit tests for the tools-versus-reasoning compatibility applied by langevals'
litellm patch.

The stub stands in for the provider, so every assertion is about the request
that actually leaves langevals. No API keys and no network.

Async tests are marked with anyio, whose pytest plugin ships with the anyio
langevals-core already depends on and defaults to the asyncio backend.

Spec: specs/evaluators/langevals-judge-reasoning-tool-compatibility.feature
"""

import inspect
import os
from typing import Optional

import litellm
import pytest

from langevals_core import litellm_patch
from langevals_core.litellm_patch import ToolReasoningConflictError, patch_litellm

# The rejection as the provider words it, captured from a Comparison run whose
# evaluator model resolved to openai/gpt-5.6-sol.
PROVIDER_TOOL_REASONING_REFUSAL = (
    "litellm.BadRequestError: OpenAIException - Function tools with "
    "reasoning_effort are not supported for gpt-5.6-sol in "
    "/v1/chat/completions. To use function tools, use /v1/responses or set "
    "reasoning_effort to 'none'."
)

# What the stub answers with when it is not refusing, standing in for the
# verdict the judge came for.
PROVIDER_ANSWER = "verdict response"

AFFECTED_MODELS = [
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-6-astra",
    "openai/gpt-6-luna",
    "openai/gpt-6-sol",
    "openai/gpt-6.1-sol",
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
    lined up for it.

    The blocking and the awaitable entry points share one record, so a test
    reads the request the same way whichever one the evaluator drove.
    """

    def __init__(self):
        self.requests: list[dict] = []
        self.refusal: Optional[BaseException] = None
        self.refusals: list[BaseException] = []

    def __call__(self, *args, **kwargs):
        return self._respond(kwargs)

    async def acall(self, *args, **kwargs):
        return self._respond(kwargs)

    def _respond(self, kwargs: dict):
        self.requests.append(kwargs)
        if self.refusal is not None:
            raise self.refusal
        if self.refusals:
            raise self.refusals.pop(0)
        return PROVIDER_ANSWER

    @property
    def last_request(self) -> dict:
        return self.requests[-1]


@pytest.fixture
def provider(monkeypatch):
    """langevals' litellm patch driving a stub provider, so a judge request can
    be read exactly as the provider would receive it.

    The patch installs once per process and then calls the entry points it
    captured in `litellm_patch.originals`. The stub goes there, at the
    innermost layer, so the request travels the real patched path, and one
    fixture covers the evaluators that block on their judge and the ones that
    await it. X_LITELLM_ variables are cleared because the patch merges them
    into every request, and an ambient reasoning effort would read here as a
    caller's explicit choice.
    """
    for key in list(os.environ):
        if key.startswith("X_LITELLM_"):
            monkeypatch.delenv(key)

    patch_litellm()
    stub = _Provider()
    monkeypatch.setitem(litellm_patch.originals, "completion", stub)
    monkeypatch.setitem(litellm_patch.originals, "acompletion", stub.acall)
    monkeypatch.setattr(litellm_patch, "tool_reasoning_off_models", set())
    monkeypatch.setattr(litellm_patch, "temperature_pinned_models", set())
    monkeypatch.setattr(litellm_patch, "forced_tool_choice_refusers", set())
    return stub


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


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
@pytest.mark.parametrize("model", AFFECTED_MODELS)
def test_affected_model_disables_reasoning_by_default(provider, model):
    litellm.completion(**judge_request(model))

    assert provider.last_request["reasoning_effort"] == "none"


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_reasoning_off_is_sent_even_when_litellm_does_not_know_the_model(provider):
    """litellm 1.96 does not list reasoning_effort for openai/gpt-6-luna, and
    with drop_params on it would strip the setting before the request left."""
    litellm.completion(
        **judge_request("openai/gpt-6-luna", allowed_openai_params=["seed"])
    )

    assert provider.last_request["allowed_openai_params"] == [
        "seed",
        "reasoning_effort",
    ]


# @scenario "A model that starts refusing is asked again with its reasoning off"
def test_unseen_model_that_refuses_is_asked_again_with_reasoning_off(provider):
    provider.refusals = [Exception(PROVIDER_TOOL_REASONING_REFUSAL)]

    answer = litellm.completion(**judge_request("openai/gpt-7-new"))

    first, second = provider.requests
    assert "reasoning_effort" not in first
    assert second["reasoning_effort"] == "none"
    assert "reasoning_effort" in second["allowed_openai_params"]
    assert second["tool_choice"] == FORCED_TOOL_CHOICE
    assert answer == PROVIDER_ANSWER


# @scenario "A model that starts refusing is asked again with its reasoning off"
def test_model_seen_refusing_is_asked_with_reasoning_off_from_then_on(provider):
    provider.refusals = [Exception(PROVIDER_TOOL_REASONING_REFUSAL)]
    litellm.completion(**judge_request("openai/gpt-7-new"))

    litellm.completion(**judge_request("openai/gpt-7-new"))

    assert len(provider.requests) == 3
    assert provider.last_request["reasoning_effort"] == "none"


# @scenario "A model that starts refusing is asked again with its reasoning off"
@pytest.mark.anyio
async def test_awaited_unseen_model_that_refuses_is_asked_again(provider):
    provider.refusals = [Exception(PROVIDER_TOOL_REASONING_REFUSAL)]

    answer = await litellm.acompletion(**judge_request("openai/gpt-7-new"))

    assert provider.last_request["reasoning_effort"] == "none"
    assert answer == PROVIDER_ANSWER


# @scenario "A reasoning effort the caller chose is the one that is used"
def test_refusal_of_a_chosen_reasoning_effort_is_not_retried(provider):
    provider.refusals = [Exception(PROVIDER_TOOL_REASONING_REFUSAL)]

    with pytest.raises(ToolReasoningConflictError):
        litellm.completion(
            **judge_request("openai/gpt-7-new", reasoning_effort="high")
        )

    assert len(provider.requests) == 1


# @scenario "A reasoning effort the caller chose is the one that is used"
def test_explicit_reasoning_effort_beats_the_compatibility_default(provider):
    litellm.completion(
        **judge_request("openai/gpt-5.6-sol", reasoning_effort="high")
    )

    assert provider.last_request["reasoning_effort"] == "high"


# @scenario "A model nobody has seen refuse keeps the behaviour it has today"
@pytest.mark.parametrize("model", UNVERIFIED_MODELS)
def test_unverified_model_keeps_its_reasoning_untouched(provider, model):
    litellm.completion(**judge_request(model))

    assert "reasoning_effort" not in provider.last_request


# @scenario "An evaluator that asks for no verdict keeps its reasoning"
def test_request_without_tools_keeps_its_reasoning_untouched(provider):
    litellm.completion(
        model="openai/gpt-5.6-sol",
        messages=[{"role": "user", "content": "Summarize this."}],
    )

    assert "reasoning_effort" not in provider.last_request


# @scenario "The evaluator's own question reaches the model unchanged"
def test_forced_function_call_reaches_the_provider_unchanged(provider):
    litellm.completion(**judge_request("openai/gpt-5.6-sol"))

    assert provider.last_request["tools"] == [VERDICT_TOOL]
    assert provider.last_request["tool_choice"] == FORCED_TOOL_CHOICE


# @scenario "A refusal over the reasoning setting says what to change"
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


# @scenario "A refusal that is not this conflict reaches the caller untouched"
def test_unrelated_provider_rejection_reaches_the_caller_unchanged(provider):
    refusal = Exception("OpenAIException - context_length_exceeded")
    provider.refusal = refusal

    with pytest.raises(Exception) as raised:
        litellm.completion(**judge_request("openai/gpt-5.6-sol"))

    assert raised.value is refusal


# @scenario "A refusal that is not this conflict reaches the caller untouched"
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


# Evaluators that judge several entries at once reach the model through the
# awaitable entry point instead of the blocking one. It is patched too, and a
# verdict has to come back there on the same terms.


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
@pytest.mark.anyio
@pytest.mark.parametrize("model", AFFECTED_MODELS)
async def test_awaited_affected_model_disables_reasoning_by_default(provider, model):
    answer = await litellm.acompletion(**judge_request(model))

    assert provider.last_request["reasoning_effort"] == "none"
    assert answer == PROVIDER_ANSWER


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
@pytest.mark.anyio
async def test_awaited_and_blocking_judges_send_the_same_request(provider):
    """Awaiting the judge has to be the same conversation as blocking on it,
    down to the request, or the compatibility only holds for half the
    evaluators.
    """
    assert inspect.iscoroutinefunction(litellm.acompletion)

    litellm.completion(**judge_request("openai/gpt-5.6-sol"))
    await litellm.acompletion(**judge_request("openai/gpt-5.6-sol"))

    blocking, awaited = provider.requests
    assert blocking == awaited


# @scenario "A refusal over the reasoning setting says what to change"
@pytest.mark.anyio
async def test_awaited_conflict_is_reported_as_a_fixable_configuration_problem(
    provider,
):
    provider.refusal = Exception(PROVIDER_TOOL_REASONING_REFUSAL)

    with pytest.raises(ToolReasoningConflictError) as raised:
        await litellm.acompletion(**judge_request("openai/gpt-5.6-sol-pro"))

    message = str(raised.value)
    assert "openai/gpt-5.6-sol-pro" in message
    assert "reasoning effort" in message
    assert "none" in message
    assert "/v1/responses" not in message
    assert "OpenAIException" not in message


# @scenario "A refusal that is not this conflict reaches the caller untouched"
@pytest.mark.anyio
async def test_awaited_unrelated_rejection_reaches_the_caller_unchanged(provider):
    refusal = Exception("OpenAIException - context_length_exceeded")
    provider.refusal = refusal

    with pytest.raises(Exception) as raised:
        await litellm.acompletion(**judge_request("openai/gpt-5.6-sol"))

    assert raised.value is refusal
