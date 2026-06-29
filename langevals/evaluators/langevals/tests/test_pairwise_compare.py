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
    assert result.label == "A"
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

    assert result.label == "A"
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

    assert result.label == "B"
    assert result.score == 1.0
