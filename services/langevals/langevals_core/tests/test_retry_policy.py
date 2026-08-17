"""Unit tests for the retry policy in `BaseEvaluator._evaluate_entry`.

A deterministic 400 from the provider (a content-policy block, a bad
parameter) must not be retried: retrying only burns time and can push a single
evaluation past the caller's request timeout, turning a clear error into an
opaque one. A transient error (a 5xx, a rate limit) must still be retried.

The fake evaluator counts calls through a module-level list, so every
assertion is about how many attempts `_evaluate_entry` makes. No API keys and
no network.
"""

import litellm
from pydantic import Field

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
)


class CountingEntry(EvaluatorEntry):
    output: str = Field(default="")


class CountingSettings(LLMEvaluatorSettings):
    pass


class CountingResult(EvaluationResult):
    pass


def make_evaluator(exception: Exception, calls: list):
    class CountingEvaluator(
        BaseEvaluator[CountingEntry, CountingSettings, CountingResult]
    ):
        name = "Counting"
        category = "quality"
        env_vars = []
        is_guardrail = False

        def evaluate(self, entry: CountingEntry) -> SingleEvaluationResult:
            calls.append(1)
            raise exception

    return CountingEvaluator(settings=CountingSettings(model="azure/gpt-5.6-terra"))


def test_content_policy_violation_is_not_retried():
    calls: list = []
    evaluator = make_evaluator(
        litellm.ContentPolicyViolationError(
            message="filtered", model="azure/gpt-5.6-terra", llm_provider="azure"
        ),
        calls,
    )

    result = evaluator._evaluate_entry(CountingEntry(output="x"), retries=3)

    assert len(calls) == 1
    assert result.status == "error"
    assert result.error_type == "ContentPolicyViolationError"


def test_bad_request_is_not_retried():
    calls: list = []
    evaluator = make_evaluator(
        litellm.BadRequestError(
            message="bad param", model="azure/gpt-5.6-terra", llm_provider="azure"
        ),
        calls,
    )

    result = evaluator._evaluate_entry(CountingEntry(output="x"), retries=3)

    assert len(calls) == 1
    assert result.status == "error"


def test_transient_error_is_still_retried():
    calls: list = []
    evaluator = make_evaluator(RuntimeError("transient blip"), calls)

    result = evaluator._evaluate_entry(CountingEntry(output="x"), retries=3)

    assert len(calls) == 3
    assert result.status == "error"
    assert result.error_type == "RuntimeError"
