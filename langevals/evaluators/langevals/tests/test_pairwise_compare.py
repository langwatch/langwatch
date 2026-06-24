"""
Unit tests for pairwise_compare. Mocks litellm.completion at the
boundary so the swap-and-confirm logic, order translation, and
metrics injection are exercised without API keys.

Refs:
  - https://github.com/langwatch/langwatch/issues/5100  (pairwise MVP)
  - https://github.com/langwatch/langwatch/issues/5101  (select_best N-way)
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from langevals_langevals.pairwise_compare import (
    CandidateInput,
    PairwiseCompareEntry,
    PairwiseCompareEvaluator,
    PairwiseCompareSettings,
    _slot_label,
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


def test_position_bias_mitigation_overrides_legacy_swap_and_confirm():
    """
    When position_bias_mitigation is explicitly set to "none", it must
    win over swap_and_confirm=True. This is the migration path off the
    deprecated boolean.
    """
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(
            swap_and_confirm=True,
            position_bias_mitigation="none",
        )
    )
    entry = _make_entry()

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("just one call", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    assert mock_completion.call_count == 1


# ----------------------------------------------------------------------
# select_best (N-way) — #5101
# ----------------------------------------------------------------------


def _make_nway_entry(num_candidates: int = 3, **overrides):
    candidates = [
        CandidateInput(
            id=f"variant_{i}",
            output=f"output_{i}",
        )
        for i in range(num_candidates)
    ]
    base = dict(
        input="What is the capital of France?",
        golden="Paris",
        candidates=candidates,
        row_index=0,
    )
    base.update(overrides)
    return PairwiseCompareEntry(**base)


def test_select_best_skipped_when_fewer_than_two_with_output():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(mode="select_best")
    )
    entry = _make_nway_entry(num_candidates=1)
    result = evaluator.evaluate(entry)
    assert result.status == "skipped"


def test_select_best_filters_empty_outputs_but_keeps_remainder():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(mode="select_best")
    )
    candidates = [
        CandidateInput(id="v0", output="real answer"),
        CandidateInput(id="v1", output=""),
        CandidateInput(id="v2", output="another answer"),
        CandidateInput(id="v3", output=""),
    ]
    entry = PairwiseCompareEntry(
        input="q",
        golden="g",
        candidates=candidates,
        row_index=0,
    )

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("v0 looks closer", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    # Only one judge call — select_best is single-call.
    assert mock_completion.call_count == 1
    # Result label must be one of the surviving candidate ids or "tie".
    assert result.status == "processed"
    assert result.label in {"v0", "v2", "tie"}


def test_select_best_returns_winning_candidate_id_not_slot_label():
    """
    The judge picks slot "A". After deterministic shuffle, slot A is
    whichever candidate ended up first — the evaluator must translate
    that slot back to the candidate's ORIGINAL id, not return "A".
    """
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(mode="select_best")
    )
    entry = _make_nway_entry(num_candidates=3)

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("slot A wins", "A"),
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.status == "processed"
    # The label must be one of the original ids the caller supplied,
    # NOT a slot label, and NOT "tie" (judge picked a winner).
    assert result.label in {"variant_0", "variant_1", "variant_2"}
    assert result.label not in {"A", "B", "C"}
    assert result.score == 1.0


def test_select_best_returns_tie_when_judge_ties():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(mode="select_best")
    )
    entry = _make_nway_entry(num_candidates=3)

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("indistinguishable", "tie"),
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.label == "tie"
    assert result.score == 0.5


def test_select_best_deterministic_shuffle_by_row_index():
    """
    Same row_index -> identical slot-to-candidate ordering across
    calls. Comparing rendered prompts asserts determinism without
    depending on Python's RNG implementation.
    """
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(mode="select_best")
    )
    entry_a = _make_nway_entry(num_candidates=5, row_index=42)
    entry_b = _make_nway_entry(num_candidates=5, row_index=42)

    captured_prompts: list[str] = []

    def capture(**kwargs):
        captured_prompts.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry_a)
        evaluator.evaluate(entry_b)

    assert captured_prompts[0] == captured_prompts[1]


def test_select_best_no_shuffle_when_mitigation_none():
    """
    With position_bias_mitigation="none", candidates appear in the
    prompt in the exact order the caller supplied them.
    """
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(
            mode="select_best",
            position_bias_mitigation="none",
        )
    )
    entry = _make_nway_entry(num_candidates=3, row_index=999)

    captured: list[str] = []

    def capture(**kwargs):
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    prompt = captured[0]
    idx_0 = prompt.index("output_0")
    idx_1 = prompt.index("output_1")
    idx_2 = prompt.index("output_2")
    assert idx_0 < idx_1 < idx_2


def test_select_best_metrics_injected_when_requested():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(
            mode="select_best",
            include_metrics=["cost", "duration"],
            position_bias_mitigation="none",
        )
    )
    candidates = [
        CandidateInput(id="v0", output="a", cost=0.0012, duration=0.45),
        CandidateInput(id="v1", output="b", cost=0.0007, duration=0.31),
    ]
    entry = PairwiseCompareEntry(
        input="q", golden="g", candidates=candidates, row_index=0
    )

    captured: list[str] = []

    def capture(**kwargs):
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    prompt = captured[0]
    assert "cost=$0.001200" in prompt
    assert "duration=0.450s" in prompt


def test_select_best_falls_back_to_legacy_candidate_fields():
    """
    Caller only sets candidate_a_*/candidate_b_* (pairwise-shaped
    inputs) but configures mode="select_best". The evaluator must
    synthesize a candidates list from the legacy fields and run.
    """
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(mode="select_best")
    )
    entry = PairwiseCompareEntry(
        input="q",
        golden="g",
        candidate_a_id="legacy_a",
        candidate_a_output="aa",
        candidate_b_id="legacy_b",
        candidate_b_output="bb",
        row_index=0,
    )

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("a wins", "A"),
    ), patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.label in {"legacy_a", "legacy_b", "tie"}


def test_select_best_with_five_candidates_uses_one_call():
    evaluator = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(mode="select_best")
    )
    entry = _make_nway_entry(num_candidates=5)

    with patch(
        "langevals_langevals.pairwise_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "B"),
    ) as mock_completion, patch(
        "langevals_langevals.pairwise_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    # The whole point of select_best is N candidates in a single call.
    assert mock_completion.call_count == 1


def test_slot_label_helper_covers_alphabet_and_overflow():
    """
    Slot labels keep generating past Z. We pick alphabetic labels so
    the judge can't be biased by candidate ids — the helper must
    handle >26 candidates predictably.
    """
    assert _slot_label(0) == "A"
    assert _slot_label(1) == "B"
    assert _slot_label(25) == "Z"
    assert _slot_label(26) == "AA"
    assert _slot_label(27) == "AB"
    assert _slot_label(51) == "AZ"
    assert _slot_label(52) == "BA"
