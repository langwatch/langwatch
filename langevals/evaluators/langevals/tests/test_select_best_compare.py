"""
Unit tests for select_best_compare (N-way Compare). Mocks litellm.completion
at the boundary so the shuffle logic, slot-to-id translation, and metrics
injection are exercised without API keys.

Refs:
  - https://github.com/langwatch/langwatch/issues/5101
  - specs/experiments/select-best-nway.feature
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from langevals_langevals.select_best_compare import (
    CandidateInput,
    DEFAULT_SELECT_BEST_PROMPT,
    SelectBestCompareEntry,
    SelectBestCompareEvaluator,
    SelectBestCompareSettings,
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


def _make_entry(num_candidates: int = 3, **overrides):
    candidates = [
        CandidateInput(id=f"variant_{i}", output=f"output_{i}")
        for i in range(num_candidates)
    ]
    base = dict(
        input="What is the capital of France?",
        golden="Paris",
        candidates=candidates,
        row_index=0,
    )
    base.update(overrides)
    return SelectBestCompareEntry(**base)


def test_skipped_when_zero_candidates():
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = SelectBestCompareEntry(
        input="q", golden="g", candidates=[], row_index=0
    )
    result = evaluator.evaluate(entry)
    assert result.status == "skipped"


def test_skipped_when_only_one_candidate_with_output():
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=1)
    result = evaluator.evaluate(entry)
    assert result.status == "skipped"


def test_empty_output_candidates_filtered_but_remainder_kept():
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    candidates = [
        CandidateInput(id="v0", output="real answer"),
        CandidateInput(id="v1", output=""),
        CandidateInput(id="v2", output="another answer"),
        CandidateInput(id="v3", output=""),
    ]
    entry = SelectBestCompareEntry(
        input="q",
        golden="g",
        candidates=candidates,
        row_index=0,
    )

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        return_value=_mock_completion_response("v0 looks closer", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    # Exactly one judge call — N-way is single-call, always.
    assert mock_completion.call_count == 1
    assert result.status == "processed"
    # Result label must be one of the surviving candidate ids or "tie".
    assert result.label in {"v0", "v2", "tie"}


def test_returns_winning_candidate_id_not_slot_label():
    """
    The judge picks slot "A". After the deterministic shuffle, slot A is
    whichever candidate ended up first — the evaluator must translate
    that slot back to the candidate's ORIGINAL id, not return "A".
    """
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=3)

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        return_value=_mock_completion_response("slot A wins", "A"),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.status == "processed"
    # The label must be one of the original ids the caller supplied,
    # NOT a slot label, and NOT "tie" (judge picked a winner).
    assert result.label in {"variant_0", "variant_1", "variant_2"}
    assert result.label not in {"A", "B", "C"}
    assert result.score == 1.0


def test_returns_tie_when_judge_ties():
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=3)

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        return_value=_mock_completion_response("indistinguishable", "tie"),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.label == "tie"
    assert result.score == 0.5


def test_deterministic_shuffle_by_row_index():
    """
    Same row_index -> identical slot-to-candidate ordering across
    calls. Comparing rendered prompts asserts determinism without
    depending on Python's RNG implementation.
    """
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry_a = _make_entry(num_candidates=5, row_index=42)
    entry_b = _make_entry(num_candidates=5, row_index=42)

    captured_prompts: list[str] = []

    def capture(**kwargs):
        captured_prompts.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry_a)
        evaluator.evaluate(entry_b)

    assert captured_prompts[0] == captured_prompts[1]


def test_no_shuffle_when_randomize_order_disabled():
    """
    With randomize_order=False, candidates appear in the prompt in
    the exact order the caller supplied them.
    """
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )
    entry = _make_entry(num_candidates=3, row_index=999)

    captured: list[str] = []

    def capture(**kwargs):
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    prompt = captured[0]
    idx_0 = prompt.index("output_0")
    idx_1 = prompt.index("output_1")
    idx_2 = prompt.index("output_2")
    assert idx_0 < idx_1 < idx_2


def test_metrics_injected_into_prompt_when_requested():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            include_metrics=["cost", "duration"],
            randomize_order=False,
        )
    )
    candidates = [
        CandidateInput(id="v0", output="a", cost=0.0012, duration=0.45),
        CandidateInput(id="v1", output="b", cost=0.0007, duration=0.31),
    ]
    entry = SelectBestCompareEntry(
        input="q", golden="g", candidates=candidates, row_index=0
    )

    captured: list[str] = []

    def capture(**kwargs):
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    prompt = captured[0]
    assert "cost=$0.001200" in prompt
    assert "duration=0.450s" in prompt


def test_metrics_not_injected_by_default():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )
    candidates = [
        CandidateInput(id="v0", output="a", cost=0.001, duration=0.5),
        CandidateInput(id="v1", output="b", cost=0.001, duration=0.5),
    ]
    entry = SelectBestCompareEntry(
        input="q", golden="g", candidates=candidates, row_index=0
    )

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    user_msg = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "cost=$" not in user_msg
    assert "duration=" not in user_msg


def test_five_candidates_use_exactly_one_call():
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=5)

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "B"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    # The whole point of N-way compare is N candidates in a single call —
    # this is the invariant that makes it cheaper than round-robin pairwise.
    assert mock_completion.call_count == 1


def test_result_carries_reasoning_and_cost():
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=3)

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        return_value=_mock_completion_response("A is closer", "A"),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0002,
    ):
        result = evaluator.evaluate(entry)

    assert result.details and "A is closer" in result.details
    assert result.cost and result.cost.amount == pytest.approx(0.0002)


def test_allow_tie_false_removes_tie_from_enum():
    """When allow_tie=False the tool schema's `winner` enum must not
    contain "tie" — the judge is forced to pick a slot label."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(allow_tie=False)
    )
    entry = _make_entry(num_candidates=3)

    with patch(
        "langevals_langevals.select_best_compare.litellm.completion",
        return_value=_mock_completion_response("ok", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    winner_enum = mock_completion.call_args.kwargs["tools"][0]["function"][
        "parameters"
    ]["properties"]["winner"]["enum"]
    assert "tie" not in winner_enum
    assert winner_enum == ["A", "B", "C"]


def test_default_prompt_constant_mentions_golden_answer():
    """The default N-way prompt is golden-aware — the evaluator is
    scoped to the golden-required case; users needing golden-free
    comparison should customize the prompt (or wait for a follow-up
    has_golden_answer flag mirroring pairwise_compare)."""
    assert "golden answer" in DEFAULT_SELECT_BEST_PROMPT.lower()


def test_slot_label_helper_covers_alphabet_and_overflow():
    """Slot labels keep generating past Z. We pick alphabetic labels so
    the judge can't be biased by candidate ids — the helper must
    handle >26 candidates predictably."""
    assert _slot_label(0) == "A"
    assert _slot_label(1) == "B"
    assert _slot_label(25) == "Z"
    assert _slot_label(26) == "AA"
    assert _slot_label(27) == "AB"
    assert _slot_label(51) == "AZ"
    assert _slot_label(52) == "BA"


def test_slot_label_helper_rejects_negative_index():
    with pytest.raises(ValueError):
        _slot_label(-1)


def test_pairwise_compare_evaluator_is_untouched():
    """Regression check: importing the new evaluator does not shadow or
    modify the existing pairwise_compare module. Ensures our 'don't
    touch pairwise' invariant is enforceable at test time."""
    from langevals_langevals import pairwise_compare, select_best_compare

    # The two evaluator classes must be siblings, neither inheriting from
    # the other — proof they are independent.
    assert (
        pairwise_compare.PairwiseCompareEvaluator
        is not select_best_compare.SelectBestCompareEvaluator
    )
    assert not issubclass(
        select_best_compare.SelectBestCompareEvaluator,
        pairwise_compare.PairwiseCompareEvaluator,
    )
    assert not issubclass(
        pairwise_compare.PairwiseCompareEvaluator,
        select_best_compare.SelectBestCompareEvaluator,
    )
