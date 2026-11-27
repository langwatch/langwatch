"""Every answered model call reports its provider usage for the spend ledger,
summed per model, and an evaluator entry returns what its calls consumed.
Provider stubbed, no keys or network.

Spec: modules/gateway/specs/gateway-platform-provider-usage.feature
"""

import os
from types import SimpleNamespace

import litellm
import pytest

from langevals_core import litellm_patch
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    EvaluatorSettings,
)
from langevals_core.litellm_patch import patch_litellm
from langevals_core.usage_ledger import collect_usage, quantities_of


def answer(prompt=0, completion=0, cached=0, reasoning=0):
    usage = SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        prompt_tokens_details=SimpleNamespace(cached_tokens=cached),
        completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning),
    )
    message = SimpleNamespace(tool_calls=None, content="ok")
    return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)


@pytest.fixture
def provider(monkeypatch):
    for key in list(os.environ):
        if key.startswith("X_LITELLM_"):
            monkeypatch.delenv(key)
    patch_litellm()
    answers: list = []

    def respond(*args, **kwargs):
        return answers.pop(0)

    async def arespond(*args, **kwargs):
        return answers.pop(0)

    monkeypatch.setitem(litellm_patch.originals, "completion", respond)
    monkeypatch.setitem(litellm_patch.originals, "acompletion", arespond)
    monkeypatch.setitem(litellm_patch.originals, "embedding", respond)
    return answers


def test_cached_tokens_are_taken_out_of_the_billable_input():
    assert quantities_of(answer(prompt=1000, completion=40, cached=600, reasoning=10)) == {
        "input_tokens": 400,
        "output_tokens": 40,
        "cache_read_input_tokens": 600,
        "cache_creation_input_tokens": 0,
        "reasoning_tokens": 10,
    }


def test_an_answer_without_usage_reports_nothing():
    assert quantities_of(SimpleNamespace(choices=[])) is None


# @scenario "A platform call on stored provider credentials lands on the ledger and debits its budgets"
def test_completion_and_embedding_calls_are_summed_per_model(provider):
    provider.extend([answer(prompt=100, completion=5), answer(prompt=50, completion=3)])
    provider.append(SimpleNamespace(usage=SimpleNamespace(prompt_tokens=2_000)))

    with collect_usage() as usage:
        litellm.completion(model="openai/gpt-5-nano", messages=[])
        litellm.completion(model="gpt-5-nano", messages=[])
        litellm.embedding(model="openai/text-embedding-3-large", input=["a"])

    by_model = {m.model: m for m in usage.models()}
    assert by_model["openai/gpt-5-nano"].calls == 2
    assert by_model["openai/gpt-5-nano"].input_tokens == 150
    assert by_model["openai/gpt-5-nano"].output_tokens == 8
    assert by_model["openai/text-embedding-3-large"].input_tokens == 2_000


@pytest.mark.anyio
async def test_awaited_completions_are_recorded(provider):
    provider.append(answer(prompt=10, completion=2))

    with collect_usage() as usage:
        await litellm.acompletion(model="anthropic/claude-sonnet-5", messages=[])

    assert [(m.model, m.input_tokens) for m in usage.models()] == [
        ("anthropic/claude-sonnet-5", 10)
    ]


def test_a_call_outside_any_collection_is_not_recorded(provider):
    provider.append(answer(prompt=10))

    litellm.completion(model="openai/gpt-5-nano", messages=[])


class _JudgeSettings(EvaluatorSettings):
    pass


class _JudgeEntry(EvaluatorEntry):
    input: str


class _JudgeResult(EvaluationResult):
    pass


class _Judge(BaseEvaluator[_JudgeEntry, _JudgeSettings, _JudgeResult]):
    name = "usage judge"
    category = "custom"
    env_vars = []

    def evaluate(self, entry: _JudgeEntry):
        litellm.completion(model="openai/gpt-5.6-luna", messages=[])
        return _JudgeResult(score=1, passed=True)


# @scenario "An evaluator entry reports the provider usage of its model calls"
def test_an_evaluator_entry_returns_the_usage_of_its_calls(provider):
    provider.append(answer(prompt=300, completion=20))

    [result] = _Judge(settings={}, env={}).evaluate_batch([_JudgeEntry(input="x")])

    assert result.usage is not None
    assert [(u.model, u.calls, u.input_tokens, u.output_tokens) for u in result.usage] == [
        ("openai/gpt-5.6-luna", 1, 300, 20)
    ]
