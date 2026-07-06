"""
Unit tests for pairwise_compare. Mocks litellm.completion at the
boundary so the swap-and-confirm logic, order translation, and
metrics injection are exercised without API keys.

Refs: https://github.com/langwatch/langwatch/issues/5100
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from langevals_langevals.pairwise_compare import (
    DEFAULT_PAIRWISE_PROMPT,
    PairwiseCompareEntry,
    PairwiseCompareEvaluator,
    PairwiseCompareSettings,
)


def _mock_completion_response(reasoning: str, winner: str):
    """Shape a fake litellm response that walks the same path as a real one."""
    arguments_json = json.dumps({"reasoning": reasoning, "winner": winner})
    tool_call = SimpleNamespace(
        function=SimpleNamespace(arguments=arguments_json)
    )
    message = SimpleNamespace(tool_calls=[tool_call])
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


def _make_entry(**overrides):
    base = dict(
        input="What is the capital of France?",
        golden="Paris",
        candidate_a_id="variant_a",
        candidate_a_output="Paris is the capital.",
        candidate_b_id="variant_b",
        candidate_b_output="It's Paris.",
    )
    base.update(overrides)
    return PairwiseCompareEntry(**base)


def test_skipped_on_missing_candidate_output():
    evaluator = PairwiseCompareEvaluator(settings=PairwiseCompareSettings())
    entry = _make_entry(candidate_b_output="")
    result = evaluator.evaluate(entry)
    assert result.status == "skipped"


def test_single_judge_call_when_swap_disabled():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(swap_and_confirm=False)
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("A is closer", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert mock_completion.call_count == 1
    assert result.label == "variant_a"
    assert result.score == 0.0
    assert result.details and "A is closer" in result.details
    assert result.cost and result.cost.amount == pytest.approx(0.0001)


def test_swap_and_confirm_issues_exactly_two_calls():
    evaluator = PairwiseCompareEvaluator(settings=PairwiseCompareSettings())
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        side_effect=[
            _mock_completion_response("call 1", "A"),
            _mock_completion_response("call 2", "B"),
        ],
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    assert mock_completion.call_count == 2


def test_swap_agreement_returns_agreed_winner():
    """
    Both calls pick the same original candidate -> that's the winner.

    Call 1 (order A,B): judge says slot "A" wins -> candidate_a wins.
    Call 2 (order B,A): judge says slot "B" wins -> candidate_a wins
                       (because slot B is now candidate_a after swap).
    Both calls agree: candidate_a (label "A").
    """
    evaluator = PairwiseCompareEvaluator(settings=PairwiseCompareSettings())
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        side_effect=[
            _mock_completion_response("first", "A"),
            _mock_completion_response("second", "B"),
        ],
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.label == "variant_a"
    assert result.score == 0.0
    assert result.cost and result.cost.amount == pytest.approx(0.0002)


def test_swap_disagreement_returns_tie():
    """Calls disagree on the original candidate -> tie."""
    evaluator = PairwiseCompareEvaluator(settings=PairwiseCompareSettings())
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        side_effect=[
            _mock_completion_response("first", "A"),
            _mock_completion_response("second", "A"),
        ],
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    # Call 1 (order A,B): slot A wins -> candidate_a.
    # Call 2 (order B,A): slot A wins -> candidate_b.
    # Disagreement -> tie.
    assert result.label == "tie"
    assert result.score == 0.5


def test_order_translation_when_swapped():
    """
    With swap_and_confirm=False but explicitly running the swapped order
    via _judge directly: judge picks slot "A", which in the swapped order
    is candidate_b. The evaluator should return "B" as the winner.
    """
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(swap_and_confirm=False)
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("picked slot A", "A"),
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator._judge(entry, ("B", "A"))

    assert result["winner"] == "B"


def test_metrics_injected_into_prompt_when_requested():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(
            swap_and_confirm=False,
            include_metrics=["cost", "duration"],
        )
    )
    entry = _make_entry(
        candidate_a_cost=0.001,
        candidate_a_duration=0.5,
        candidate_b_cost=0.0005,
        candidate_b_duration=0.3,
    )

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "tie"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    user_msg = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "Per-candidate metrics:" in user_msg
    assert "cost=$0.001000" in user_msg
    assert "duration=0.500s" in user_msg


def test_metrics_not_injected_by_default():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(swap_and_confirm=False)
    )
    entry = _make_entry(candidate_a_cost=0.001, candidate_a_duration=0.5)

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    user_msg = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "Per-candidate metrics:" not in user_msg


def test_tie_score_maps_to_half():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(swap_and_confirm=False)
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("equivalent", "tie"),
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.label == "tie"
    assert result.score == 0.5


def test_b_wins_score_is_one():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(swap_and_confirm=False)
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("B is better", "B"),
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.label == "variant_b"
    assert result.score == 1.0


# --- has_golden_answer (#5378) ------------------------------------------


def test_has_golden_answer_defaults_to_true():
    settings = PairwiseCompareSettings()
    assert settings.has_golden_answer is True


def test_golden_framing_present_by_default():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(swap_and_confirm=False)
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "tie"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    user_msg = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "golden answer" in user_msg.lower()
    assert "Golden answer:  Paris" in user_msg


def test_golden_framing_dropped_when_has_golden_answer_is_false():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(
            swap_and_confirm=False, has_golden_answer=False
        )
    )
    # golden is still populated on the entry (e.g. a stale mapping), using a
    # value distinct from the candidate outputs, to prove the template swap
    # — not just an empty {golden} substitution — is what drops the framing.
    entry = _make_entry(golden="UNIQUE_GOLDEN_MARKER_XYZ")

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "tie"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    user_msg = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "golden answer" not in user_msg.lower()
    assert "UNIQUE_GOLDEN_MARKER_XYZ" not in user_msg
    assert "on its own merits" in user_msg


def test_tool_schema_reasoning_mentions_golden_answer_by_default():
    """The judge's tool-call schema also frames "reasoning" around the
    golden answer by default — not just the user-facing prompt text."""
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(swap_and_confirm=False)
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "tie"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    reasoning_description = mock_completion.call_args.kwargs["tools"][0][
        "function"
    ]["parameters"]["properties"]["reasoning"]["description"]
    assert "golden answer" in reasoning_description.lower()


def test_tool_schema_reasoning_drops_golden_mention_when_has_golden_answer_is_false():
    """Regression: the tool-call schema used to unconditionally tell the
    judge to reason "against the golden answer" even when has_golden_answer
    is off and no golden answer is involved at all."""
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(
            swap_and_confirm=False, has_golden_answer=False
        )
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "tie"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    reasoning_description = mock_completion.call_args.kwargs["tools"][0][
        "function"
    ]["parameters"]["properties"]["reasoning"]["description"]
    assert "golden answer" not in reasoning_description.lower()
    assert "own merits" in reasoning_description.lower()


def test_custom_prompt_is_respected_even_when_has_golden_answer_is_false():
    """A user-customized prompt is an explicit choice — never silently
    rewritten by the has_golden_answer toggle."""
    custom_prompt = "My own template. Task: {input}. A: {candidate_a_output}. B: {candidate_b_output}."
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(
            swap_and_confirm=False,
            has_golden_answer=False,
            prompt=custom_prompt,
        )
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "tie"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    user_msg = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "My own template." in user_msg


def test_default_prompt_constant_is_golden_aware():
    assert "golden answer" in DEFAULT_PAIRWISE_PROMPT.lower()
