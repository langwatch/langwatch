"""
Unit tests for select_best_compare ("Comparison"). Mocks litellm.completion
at the boundary so the shuffle logic, slot-to-id translation, and metrics
injection are exercised without API keys.

Refs:
  - https://github.com/langwatch/langwatch/issues/5101
  - specs/experiments/comparison.feature
"""

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from langevals_langevals.select_best_compare import (
    CandidateInput,
    DEFAULT_SELECT_BEST_PROMPT,
    DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN,
    SelectBestCompareEntry,
    SelectBestCompareEvaluator,
    SelectBestCompareSettings,
    _slot_label,
)


def _capture_rendered_prompt(evaluator, entry) -> str:
    """Run one evaluation with the LLM mocked and return the user-message
    (rendered judge prompt) the evaluator sent to `completion`."""
    captured: list[str] = []

    def capture(**kwargs: Any) -> SimpleNamespace:
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    return captured[0]


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
        "langevals_langevals.select_best_compare.completion",
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
        "langevals_langevals.select_best_compare.completion",
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
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("indistinguishable", "tie"),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.label == "tie"
    assert result.score == 0.5


def test_out_of_enum_winner_degrades_to_first_slot():
    """Not every provider strictly enforces the tool-call `enum`, so the
    judge can return a `winner` slot that was never presented (e.g. "Z" when
    only slots A/B/C exist). The evaluator must not crash with a KeyError on
    the slot lookup — it degrades to the first slot and still returns a
    processed result naming a real candidate (mirrors legacy pairwise's
    default-slot fallback)."""
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=3)

    with patch(
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("picked a phantom slot", "Z"),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    # No exception: the phantom slot falls back to the first slot's candidate,
    # which is one of the original ids — never the phantom "Z" or "tie".
    assert result.status == "processed"
    assert result.label in {"variant_0", "variant_1", "variant_2"}
    assert result.label not in {"A", "B", "C", "Z", "tie"}
    assert result.score == 1.0


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

    def capture(**kwargs: Any) -> SimpleNamespace:
        captured_prompts.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry_a)
        evaluator.evaluate(entry_b)

    assert captured_prompts[0] == captured_prompts[1]


def test_shuffle_actually_reorders_candidates():
    """
    Regression: the determinism test above only proves the SAME seed
    produces the SAME order twice — a no-op shuffle (e.g. one that shuffles
    a copy that's then discarded, or never calls .shuffle() at all) would
    pass it just as well, since two no-ops of the same input are trivially
    equal. Assert against the actual, computed permutation for a known seed
    (row_index=42 over 5 candidates, matching random.Random(42).shuffle on
    a 5-element list) so a shuffle that silently no-ops is caught.
    """
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=5, row_index=42)

    captured: list[str] = []

    def capture(**kwargs: Any) -> SimpleNamespace:
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    prompt = captured[0]
    positions = {f"output_{i}": prompt.index(f"output_{i}") for i in range(5)}
    rendered_order = sorted(positions, key=lambda k: positions[k])

    assert rendered_order != [f"output_{i}" for i in range(5)]
    assert rendered_order == ["output_3", "output_1", "output_2", "output_4", "output_0"]


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

    def capture(**kwargs: Any) -> SimpleNamespace:
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.completion",
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

    def capture(**kwargs: Any) -> SimpleNamespace:
        captured.append(kwargs["messages"][1]["content"])
        return _mock_completion_response("ok", "A")

    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=capture,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    prompt = captured[0]
    assert "cost=$0.001200" in prompt
    assert "duration=0.450s" in prompt
    # The metrics annotations alone are unexplained noise unless the judge is
    # actually told to weigh them (see select_best_compare.py's include_metrics
    # branch). This is the feature the metrics toggle exists to deliver, not
    # just a formatting detail.
    assert "Factor these into your decision" in prompt


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
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("ok", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    user_msg = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "cost=$" not in user_msg
    assert "duration=" not in user_msg
    assert "Factor these into your decision" not in user_msg


def test_five_candidates_use_exactly_one_call():
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=5)

    with patch(
        "langevals_langevals.select_best_compare.completion",
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
        "langevals_langevals.select_best_compare.completion",
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
        "langevals_langevals.select_best_compare.completion",
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


def test_has_golden_answer_off_swaps_default_prompt_to_no_golden_variant():
    """When has_golden_answer=False AND the user hasn't customized the
    prompt, the evaluator swaps to DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN
    so the rendered judge prompt drops the reference framing entirely
    (parity with pairwise's #5378 behavior). Uses a hand-tuned prompt
    with a sentinel token to verify user prompts survive the toggle."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(has_golden_answer=False)
    )
    entry = _make_entry(num_candidates=3, golden=None)

    with patch(
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("looks fine", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)

    rendered = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "Reference:" not in rendered
    assert "there is no reference" in rendered.lower()

    # A custom prompt survives the toggle — auto-swap only happens against
    # the shipped defaults.
    custom_prompt = (
        "CUSTOM MARKER — pick best of:\nTask: {input}\n{candidates}"
    )
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            has_golden_answer=False, prompt=custom_prompt
        )
    )
    with patch(
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("ok", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        evaluator.evaluate(entry)
    rendered = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "CUSTOM MARKER" in rendered


def test_default_prompt_carries_golden_slot_and_no_golden_variant_drops_it():
    """The default N-way prompt has a {golden} slot; the golden-free
    counterpart used when has_golden_answer is off drops it entirely
    rather than blanking the value. Locks in the prompt-swap contract
    the FE auto-swap and _judge selection both depend on."""
    assert "{golden}" in DEFAULT_SELECT_BEST_PROMPT
    assert "{candidates}" in DEFAULT_SELECT_BEST_PROMPT
    assert "{golden}" not in DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN
    assert "{candidates}" in DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN


# The four shipped defaults form a (golden x input) grid. When the user hasn't
# customized the prompt, the runtime picks the one matching what THIS row
# actually provides: the golden axis is the has_golden_answer setting, the
# input axis is whether the row has a non-empty input. A missing axis drops its
# framing (no empty "Task: " / "Reference: " line).
def test_runtime_selects_golden_input_default_when_row_has_both():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(has_golden_answer=True)
    )
    entry = _make_entry(num_candidates=3, input="what is 2+2?", golden="4")

    rendered = _capture_rendered_prompt(evaluator, entry)

    assert "Task:" in rendered
    assert "Reference:" in rendered


def test_runtime_selects_golden_no_input_default_when_row_lacks_input():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(has_golden_answer=True)
    )
    entry = _make_entry(num_candidates=3, input=None, golden="4")

    rendered = _capture_rendered_prompt(evaluator, entry)

    # Reference framing stays; the Task line is dropped entirely.
    assert "Reference:" in rendered
    assert "Task:" not in rendered
    assert "Compare each candidate against the reference answer" in rendered


# Opting into golden answers says "compare against a reference", not "every row
# has one". A dataset with a blank expected_output on some rows would otherwise
# render "Reference:" with nothing after it — the exact empty-slot framing the
# per-row prompt selection exists to prevent.
def test_runtime_drops_golden_framing_when_row_has_no_golden_despite_setting_on():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(has_golden_answer=True)
    )
    entry = _make_entry(num_candidates=3, input="what is 2+2?", golden="")

    rendered = _capture_rendered_prompt(evaluator, entry)

    assert "Reference:" not in rendered
    assert "Task:" in rendered
    assert "there is no reference" in rendered.lower()


def test_runtime_drops_golden_framing_when_row_golden_is_whitespace():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(has_golden_answer=True)
    )
    entry = _make_entry(num_candidates=3, input="what is 2+2?", golden="   ")

    rendered = _capture_rendered_prompt(evaluator, entry)

    assert "Reference:" not in rendered


def test_runtime_selects_no_golden_input_default_when_golden_off_with_input():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(has_golden_answer=False)
    )
    entry = _make_entry(num_candidates=3, input="what is 2+2?", golden=None)

    rendered = _capture_rendered_prompt(evaluator, entry)

    # Task framing stays; the reference framing is dropped and the judge is
    # told to compare on merits.
    assert "Task:" in rendered
    assert "Reference:" not in rendered
    assert "there is no reference" in rendered.lower()


def test_runtime_selects_no_golden_no_input_default_when_row_has_neither():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(has_golden_answer=False)
    )
    entry = _make_entry(num_candidates=3, input=None, golden=None)

    rendered = _capture_rendered_prompt(evaluator, entry)

    # Neither Task nor Reference framing; judge compares on merits.
    assert "Task:" not in rendered
    assert "Reference:" not in rendered
    assert "no task description" in rendered.lower()


@pytest.mark.parametrize("has_golden", [True, False])
@pytest.mark.parametrize(
    "entry_kwargs",
    [{"input": "q", "golden": "g"}, {"input": None, "golden": None}],
)
def test_customized_prompt_is_never_swapped_by_runtime_selection(
    has_golden, entry_kwargs
):
    """A hand-tuned prompt matches none of the four shipped defaults, so the
    runtime leaves it untouched across every (golden x input) combination."""
    custom_prompt = (
        "SENTINEL judge prompt\nTask: {input}\nRef: {golden}\n{candidates}"
    )
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            has_golden_answer=has_golden, prompt=custom_prompt
        )
    )
    entry = _make_entry(num_candidates=3, **entry_kwargs)

    rendered = _capture_rendered_prompt(evaluator, entry)

    assert "SENTINEL judge prompt" in rendered


def test_custom_prompt_with_unknown_braces_does_not_crash():
    """A customized judge prompt may contain unknown placeholders (e.g.
    {candidate_notes}) or a stray literal brace (e.g. a rubric like "score
    out of {10"). The evaluator substitutes known slots with str.replace,
    NOT str.format, so unknown/unbalanced braces pass through verbatim
    instead of raising KeyError/ValueError. This test crashes against the
    old str.format() rendering and passes now."""
    custom_prompt = (
        "Pick the best.\n"
        "Task: {input}\n"
        "Notes: {candidate_notes}\n"  # unknown placeholder -> KeyError under str.format
        "Rubric: score out of {10\n"  # stray literal brace -> ValueError under str.format
        "Candidates:\n{candidates}"
    )
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(prompt=custom_prompt)
    )
    entry = _make_entry(num_candidates=3)

    with patch(
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("ok", "A"),
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    # No exception raised while rendering the prompt.
    assert result.status == "processed"
    # The unknown placeholder survives verbatim in the rendered prompt, while
    # the known {input}/{candidates} slots were substituted.
    rendered = mock_completion.call_args.kwargs["messages"][1]["content"]
    assert "{candidate_notes}" in rendered
    assert "{input}" not in rendered
    assert "{candidates}" not in rendered


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


def test_pairwise_compare_evaluator_is_independent():
    """Regression check: importing the new evaluator does not shadow the
    existing pairwise_compare module or couple the two classes together.
    pairwise_compare.py itself does change in this PR (deprecation marker
    on its name/docstring) — this only guards that the two evaluators stay
    structurally independent, not that pairwise_compare is byte-for-byte
    untouched."""
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
