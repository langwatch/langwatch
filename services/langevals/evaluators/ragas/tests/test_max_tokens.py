"""
Unit tests for the entry size check every Ragas evaluator runs before it
calls the judge. No API keys and no network: the token count is patched.

Spec: specs/evaluators/ragas-max-tokens.feature
"""

from unittest.mock import patch

from langevals_core.base_evaluator import MAX_TOKENS_HARD_LIMIT
from langevals_ragas.lib.common import RagasSettings, check_max_tokens
from langevals_ragas.response_context_precision import (
    RagasResponseContextPrecisionEntry,
    RagasResponseContextPrecisionEvaluator,
)
from langevals_ragas.response_context_recall import (
    RagasResponseContextRecallEntry,
    RagasResponseContextRecallEvaluator,
)
from langevals_ragas.sql_query_equivalence import (
    RagasSQLQueryEquivalenceEntry,
    RagasSQLQueryEquivalenceEvaluator,
)


def _check_with(total_tokens: int, max_tokens: int):
    with patch(
        "langevals_ragas.lib.common.calculate_total_tokens",
        return_value=total_tokens,
    ):
        return check_max_tokens(
            input="question",
            output="answer",
            contexts=["context"],
            settings=RagasSettings(
                model="anthropic/claude-sonnet-4-5", max_tokens=max_tokens
            ),
        )


# @scenario "An entry within the configured max tokens is evaluated"
def test_an_entry_within_the_configured_limit_is_not_skipped():
    assert _check_with(total_tokens=23000, max_tokens=64000) is None


# @scenario "An entry over the configured max tokens is skipped with the configured limit in the reason"
def test_an_entry_over_the_configured_limit_is_skipped_naming_that_limit():
    result = _check_with(total_tokens=70000, max_tokens=64000)

    assert result is not None
    assert result.status == "skipped"
    assert result.details == "Total tokens exceed the maximum of 64000: 70000"


# @scenario "The shared hard limit still bounds the setting"
def test_the_shared_hard_limit_bounds_the_setting():
    result = _check_with(
        total_tokens=MAX_TOKENS_HARD_LIMIT + 1, max_tokens=MAX_TOKENS_HARD_LIMIT * 2
    )

    assert result is not None
    assert result.status == "skipped"
    assert f"maximum of {MAX_TOKENS_HARD_LIMIT}:" in (result.details or "")


# Every evaluator counts the payload its scorer actually reads. An
# under-counted guard lets a payload through that the judge then refuses, so
# the evaluator fails instead of skipping. The check runs before the scorer, so
# patching the token count to an impossible number and reading back the entry
# it was handed covers the call site without a model.


def _counted_payload(evaluator_module: str, evaluator, entry):
    """The entry the token count was handed, and the skip the guard returned."""
    counted = {}

    def _capture(model, generic_entry):
        counted["entry"] = generic_entry
        return MAX_TOKENS_HARD_LIMIT * 10

    with patch(f"{evaluator_module}.prepare_llm", return_value=(None, None)):
        with patch(
            "langevals_ragas.lib.common.calculate_total_tokens", side_effect=_capture
        ):
            result = evaluator.evaluate(entry)

    return counted["entry"], result


# @scenario "Every Ragas evaluator counts the payload its scorer reads"
def test_response_context_precision_counts_the_question_and_the_contexts():
    evaluator = RagasResponseContextPrecisionEvaluator(settings=RagasSettings())
    counted, result = _counted_payload(
        "langevals_ragas.response_context_precision",
        evaluator,
        RagasResponseContextPrecisionEntry(
            input="the question",
            output="the answer",
            contexts=["the retrieved context"],
            expected_output="the reference",
        ),
    )

    assert result is not None and result.status == "skipped"
    assert counted.input == "the question"
    assert counted.contexts == ["the retrieved context"]
    # With a reference the scorer reads the reference, not the answer.
    assert counted.expected_output == "the reference"
    assert counted.output is None


# @scenario "Every Ragas evaluator counts the payload its scorer reads"
def test_response_context_precision_counts_the_answer_without_a_reference():
    evaluator = RagasResponseContextPrecisionEvaluator(settings=RagasSettings())
    counted, _ = _counted_payload(
        "langevals_ragas.response_context_precision",
        evaluator,
        RagasResponseContextPrecisionEntry(
            input="the question",
            output="the answer",
            contexts=["the retrieved context"],
        ),
    )

    assert counted.output == "the answer"
    assert counted.contexts == ["the retrieved context"]


# @scenario "Every Ragas evaluator counts the payload its scorer reads"
def test_response_context_recall_counts_the_question_and_the_contexts():
    evaluator = RagasResponseContextRecallEvaluator(settings=RagasSettings())
    counted, result = _counted_payload(
        "langevals_ragas.response_context_recall",
        evaluator,
        RagasResponseContextRecallEntry(
            input="the question",
            output="the answer",
            contexts=["the retrieved context"],
            expected_output="the reference",
        ),
    )

    assert result is not None and result.status == "skipped"
    assert counted.input == "the question"
    assert counted.output == "the answer"
    assert counted.expected_output == "the reference"
    assert counted.contexts == ["the retrieved context"]


# @scenario "Every Ragas evaluator counts the payload its scorer reads"
def test_sql_query_equivalence_counts_the_expected_contexts():
    evaluator = RagasSQLQueryEquivalenceEvaluator(settings=RagasSettings())
    counted, result = _counted_payload(
        "langevals_ragas.sql_query_equivalence",
        evaluator,
        RagasSQLQueryEquivalenceEntry(
            output="SELECT 1",
            expected_output="SELECT 1 AS one",
            expected_contexts=["CREATE TABLE t (id int)"],
        ),
    )

    assert result is not None and result.status == "skipped"
    assert counted.output == "SELECT 1"
    assert counted.expected_output == "SELECT 1 AS one"
    assert counted.contexts == ["CREATE TABLE t (id int)"]
