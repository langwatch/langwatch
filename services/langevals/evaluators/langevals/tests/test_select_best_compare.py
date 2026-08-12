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
    # swap_and_reconcile=False: this test is about candidate filtering, not
    # order-swap reconciliation (covered separately below), so it isolates
    # the single-call path to keep its own assertions simple and focused.
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
    )
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

    # Exactly one judge call — N-way is single-call, always (per direction).
    assert mock_completion.call_count == 1
    assert result.status == "processed"
    # Result label must be one of the surviving candidate ids or "tie".
    assert result.label in {"v0", "v2", "tie"}


def test_returns_winning_candidate_id_not_slot_label():
    """
    The judge picks slot "A". After the deterministic shuffle, slot A is
    whichever candidate ended up first — the evaluator must translate
    that slot back to the candidate's ORIGINAL id, not return "A".

    swap_and_reconcile=False: this pins _judge()'s single-call translation
    logic in isolation; reconciliation across the two directions is its
    own test group below.
    """
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
    )
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
    default-slot fallback). swap_and_reconcile=False isolates this
    single-call defensive-fallback behavior from order-swap reconciliation."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
    )
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

    swap_and_reconcile=False: with it on, each evaluate() call captures TWO
    prompts (original + reversed order), which would shift the indices this
    test compares. Shuffle determinism and swap-and-reconcile are independent
    concerns, so this test isolates the former.
    """
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
    )
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
    # swap_and_reconcile=False: this test pins the N-way-single-call
    # invariant (all N candidates judged in ONE completion call, not one
    # call per candidate/pair) — a property of _judge() itself, independent
    # of whether evaluate() invokes _judge() once or twice per row.
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
    )
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
    # swap_and_reconcile=False: this test is about the plumbing from
    # _judge()'s reasoning/cost through to the final result, not about
    # reconciliation across two calls (covered separately below, including
    # its own cost-summing assertion).
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
    )
    entry = _make_entry(num_candidates=3)

    with patch(
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("closer to the reference", "A"),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0002,
    ):
        result = evaluator.evaluate(entry)

    assert result.details and "closer to the reference" in result.details
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
    # One judge call, so the outcome turns on prompt RENDERING and nothing
    # else. With reconciliation on, the mock answers slot "A" for both calls —
    # a different real candidate each time, since the order is reversed — so
    # the row would be skipped as order-sensitive and this test would be
    # reporting on reconciliation rather than on braces.
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            prompt=custom_prompt, swap_and_reconcile=False
        )
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


# ---------------------------------------------------------------------------
# swap_and_reconcile: the judge is called twice per row by default — once in
# the (possibly shuffled) candidate order, once with that order fully
# reversed — and a disagreement between the two verdicts is treated as a tie
# rather than trusting either individual call.
# ---------------------------------------------------------------------------


def test_swap_and_reconcile_defaults_to_true():
    """Cost is not a concern for judge calls — statistical truth is
    prioritized, so swap-and-reconcile ships default ON, not opt-in."""
    assert SelectBestCompareSettings().swap_and_reconcile is True


def test_swap_and_reconcile_agreement_sums_cost_and_keeps_call_one_reasoning():
    """Both calls (original + reversed order) name the SAME real candidate.
    The reconciliation trusts the agreement: final winner is that candidate,
    score 1.0, cost is the SUM of both calls' costs, and the details are call
    1's reasoning with a short confirmation prefix."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )
    entry = _make_entry(num_candidates=3, row_index=0)

    # randomize_order=False -> ordered=[variant_0, variant_1, variant_2] for
    # call 1 (slot B = variant_1); reversed=[variant_2, variant_1, variant_0]
    # for call 2 (slot B = variant_1 too — the middle slot of an odd-length
    # list is invariant under full reversal). Mocking "B" both times is a
    # genuine real-candidate agreement, not a coincidence of slot letters.
    responses = [
        _mock_completion_response("variant_1 handles the edge case", "B"),
        _mock_completion_response("variant_1 still wins reversed", "B"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        side_effect=[0.0002, 0.0003],
    ):
        result = evaluator.evaluate(entry)

    assert mock_completion.call_count == 2
    assert result.label == "variant_1"
    assert result.score == 1.0
    assert result.details is not None
    # The default judge is a gpt-5-family model, which forces temperature 1.0,
    # so the two calls differed in candidate order AND in sampling. The
    # agreement is if anything stronger for that — but it is no longer a claim
    # about order specifically, and the copy must not make one.
    assert (
        "Confirmed on a second call with the candidate order reversed."
        in result.details
    )
    assert "variant_1 handles the edge case" in result.details
    assert result.cost is not None
    assert result.cost.amount == pytest.approx(0.0002 + 0.0003)


def test_swap_and_reconcile_agreement_claims_order_only_when_temperature_is_pinned():
    """A judge that can be pinned to temperature 0 differs between the two
    calls ONLY in candidate order, so surviving it is a statement about order
    and the copy is allowed to say so."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            randomize_order=False, model="openai/gpt-4.1", temperature=0.0
        )
    )
    entry = _make_entry(num_candidates=3, row_index=0)

    responses = [
        _mock_completion_response("variant_1 handles the edge case", "B"),
        _mock_completion_response("variant_1 still wins reversed", "B"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.label == "variant_1"
    assert result.details is not None
    assert "Confirmed under order swap." in result.details


def test_swap_and_reconcile_disagreement_is_skipped_with_informative_details():
    """First call (original order) names one candidate; reversed order names
    a different one — a genuine order-sensitive verdict.

    Skipped, NOT scored a tie, and this is the default path (`allow_tie` is
    True). "They tied" and "we could not get a stable answer" are different
    claims and only the second is true: a tie is real evidence, scored 0.5/0.5
    into the pairwise tally behind the leaderboard, so reporting one here
    feeds the ranking a measurement that was never made.

    Nor is it a guess at which direction was right — the reasoning has to name
    both original picks rather than just saying they disagreed."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )
    entry = _make_entry(num_candidates=3, row_index=0)

    # ordered=[variant_0, variant_1, variant_2] (call 1); reversed=
    # [variant_2, variant_1, variant_0] (call 2). Slot "A" is variant_0 in
    # call 1 but variant_2 in call 2 — genuinely different real candidates.
    responses = [
        _mock_completion_response("variant_0 is more concise", "A"),
        _mock_completion_response("variant_2 covers more ground", "A"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert mock_completion.call_count == 2
    assert result.status == "skipped"
    # Neither of the two ways of pretending there was an answer.
    assert getattr(result, "label", None) != "tie"
    assert getattr(result, "score", None) is None
    assert result.details is not None
    # The reasoning must be genuinely informative — naming both picks and
    # both original reasonings, not just "verdicts disagreed".
    assert "variant_0" in result.details
    assert "variant_2" in result.details
    assert "variant_0 is more concise" in result.details
    assert "variant_2 covers more ground" in result.details


def test_swap_and_reconcile_disagreement_still_reports_what_the_judge_calls_cost():
    """An inconclusive row is the most expensive kind there is: two judge
    calls and no verdict. The spend is real and has to be reported, or the
    rows that cost the most are exactly the ones missing from the bill."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )
    entry = _make_entry(num_candidates=3, row_index=0)

    responses = [
        _mock_completion_response("variant_0 is more concise", "A"),
        _mock_completion_response("variant_2 covers more ground", "A"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        side_effect=[0.0002, 0.0003],
    ):
        result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert result.cost is not None
    assert result.cost.amount == pytest.approx(0.0002 + 0.0003)
    assert result.cost.currency == "USD"


def test_pre_call_skip_reports_no_cost():
    """A row skipped before any judge call was never billed, so it must not
    claim a cost of zero either: the field stays absent."""
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = SelectBestCompareEntry(
        input="q",
        golden="g",
        candidates=[CandidateInput(id="only", output="just one")],
        row_index=0,
    )

    result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert result.cost is None


def test_swap_and_reconcile_disagreement_with_allow_tie_false_is_skipped():
    """The same outcome with ties explicitly disabled — the point being that
    it IS the same outcome.

    A reconciliation failure is an absent verdict, which is not a thing
    `allow_tie` has an opinion about; it decides whether the JUDGE may call
    two candidates equivalent. Branching on it here made the evaluator state
    the objection and then act against it on the default path. This case is
    kept alongside the default-settings one above so that any future change
    that re-couples them fails."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            randomize_order=False, allow_tie=False
        )
    )
    entry = _make_entry(num_candidates=3, row_index=0)

    # Slot "A" is variant_0 in call 1 and variant_2 in call 2 — genuinely
    # different real candidates, i.e. a real order-sensitive disagreement.
    responses = [
        _mock_completion_response("variant_0 is more concise", "A"),
        _mock_completion_response("variant_2 covers more ground", "A"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert mock_completion.call_count == 2
    assert result.status == "skipped"
    # Never the forbidden value, and never a silent score either: 1.0 would
    # read as a win for no candidate, 0.5 would be the ruled-out tie.
    assert getattr(result, "label", None) != "tie"
    assert getattr(result, "score", None) is None
    assert result.details is not None
    # Still has to say WHY it could not decide, naming both picks.
    assert "variant_0" in result.details
    assert "variant_2" in result.details
    assert "does not establish a winner" in result.details


def test_swap_and_reconcile_both_calls_tie_stays_tie():
    """Trivial agreement case worth its own explicit test: both directions
    independently return 'tie' -> the final verdict is a tie, not treated
    as a special case that skips confirmation."""
    evaluator = SelectBestCompareEvaluator(settings=SelectBestCompareSettings())
    entry = _make_entry(num_candidates=3)

    responses = [
        _mock_completion_response("indistinguishable, original order", "tie"),
        _mock_completion_response("indistinguishable, reversed order", "tie"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ) as mock_completion, patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert mock_completion.call_count == 2
    assert result.label == "tie"
    assert result.score == 0.5
    assert result.details is not None
    # A tie the JUDGE declared twice is a real finding and stays scored — it
    # is only a RECONCILIATION failure that has no verdict to report.
    assert (
        "Confirmed on a second call with the candidate order reversed."
        in result.details
    )


def test_swap_and_reconcile_false_makes_exactly_one_call():
    """Regression pinning the escape hatch: swap_and_reconcile=False must
    fully restore the original single-call behavior — not merely skip the
    reconciliation logic while still calling the judge twice."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
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

    assert mock_completion.call_count == 1
    assert result.status == "processed"
    assert result.label in {"variant_0", "variant_1", "variant_2"}
    assert result.score == 1.0
    # No "Confirmed under order swap." prefix — the reconcile path never ran.
    assert result.details == "ok"


def test_reversed_call_receives_candidates_in_reverse_of_call_one():
    """Pins that the SECOND swap-and-reconcile call truly reverses call 1's
    candidate order, not some other perturbation (e.g. re-shuffling)."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )
    entry = _make_entry(num_candidates=4, row_index=0)

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

    assert len(captured) == 2
    prompt1, prompt2 = captured

    def order_of(prompt: str) -> list[str]:
        positions = {
            f"output_{i}": prompt.index(f"output_{i}") for i in range(4)
        }
        return sorted(positions, key=lambda k: positions[k])

    order1 = order_of(prompt1)
    order2 = order_of(prompt2)
    assert order1 == ["output_0", "output_1", "output_2", "output_3"]
    assert order2 == list(reversed(order1))


def test_system_message_tells_judge_to_ignore_candidate_order():
    """Anti-position-bias instruction: the system message must tell the
    judge to weigh content only, independent of candidate order."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(swap_and_reconcile=False)
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

    system_msg = mock_completion.call_args.kwargs["messages"][0]["content"]
    assert "ignore the order" in system_msg.lower()


# ---------------------------------------------------------------------------
# temperature: gpt-5-family models require temperature=1.0 and reject any
# other value (litellm precedent: model_to_dspy_lm in llm_answer_match.py).
# Every other model gets the user's configured value, with drop_params=True
# so litellm silently strips the param for providers that reject it.
# ---------------------------------------------------------------------------


def test_temperature_defaults_to_zero():
    assert SelectBestCompareSettings().temperature == 0.0


@pytest.mark.parametrize(
    "model,expected_temperature",
    [
        ("openai/gpt-5-mini", 1.0),
        ("openai/gpt-5", 1.0),
        ("azure/gpt-5-turbo", 1.0),
        ("anthropic/claude-sonnet-4", 0.0),
    ],
)
def test_temperature_forced_to_one_for_gpt5_family_models(
    model, expected_temperature
):
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(model=model, swap_and_reconcile=False)
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

    assert mock_completion.call_args.kwargs["temperature"] == expected_temperature
    assert mock_completion.call_args.kwargs["drop_params"] is True


def test_custom_temperature_passed_through_for_non_gpt5_models():
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            model="anthropic/claude-sonnet-4",
            temperature=0.7,
            swap_and_reconcile=False,
        )
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

    assert mock_completion.call_args.kwargs["temperature"] == 0.7
    assert mock_completion.call_args.kwargs["drop_params"] is True


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


def test_disagreement_details_do_not_blame_order_when_sampling_is_not_pinned():
    """gpt-5-family models are forced to temperature=1.0, so the two
    reconcile calls differ in TWO ways: candidate order AND sampling. The
    conclusion (this row establishes no winner) still holds, but attributing
    the flip to candidate order specifically is a cause the run did not
    establish — the judge was never asked the same question twice."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            model="openai/gpt-5-mini", randomize_order=False
        )
    )
    entry = _make_entry(num_candidates=3, row_index=0)

    responses = [
        _mock_completion_response("variant_0 is more concise", "A"),
        _mock_completion_response("variant_2 covers more ground", "A"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.details is not None
    # The finding — no winner here — must survive.
    assert "does not establish a winner" in result.details
    # But the cause must not be asserted, because it was not isolated.
    assert "changed with candidate order" not in result.details


# ---------------------------------------------------------------------------
# Slot-label translation in the reasoning. The judge argues in terms of the
# anonymized slots it was shown ("Candidate C is more complete than A"), so
# the explanation is translated back to real candidate ids the same way the
# winner is. Prose comes first: the article in "A concise answer is better"
# survives, because a corrupted sentence is worse than a leftover letter.
# ---------------------------------------------------------------------------

_NAMED_IDS = ("plain", "detailed", "thorough")


def _named_entry(ids: tuple[str, ...] = _NAMED_IDS) -> SelectBestCompareEntry:
    """A row whose candidates have human-readable ids, so a translated
    reasoning is obviously translated. With randomize_order off the slots are
    A=plain, B=detailed, C=thorough."""
    return SelectBestCompareEntry(
        input="Explain the tradeoff between the two designs",
        golden="A short explanation with a concrete example",
        candidates=[CandidateInput(id=id_, output=f"{id_} output") for id_ in ids],
        row_index=0,
    )


def _details_for(reasoning: str, winner: str = "C") -> str:
    """Run one judge call answering `reasoning`/`winner` and return the
    details the caller would read."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            randomize_order=False, swap_and_reconcile=False
        )
    )

    with patch(
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response(reasoning, winner),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(_named_entry())

    assert result.details is not None
    return result.details


# @scenario "The verdict reasoning names candidates, not slot letters"
def test_explicit_candidate_reference_names_the_real_candidate():
    details = _details_for("Candidate C most closely matches the reference.")

    assert details == "Candidate thorough most closely matches the reference."


# @scenario "The verdict reasoning names candidates, not slot letters"
def test_lowercase_candidate_reference_names_the_real_candidate():
    details = _details_for("candidate c is the most complete reply.")

    assert details == "candidate thorough is the most complete reply."


# @scenario "The verdict reasoning names candidates, not slot letters"
def test_translated_reasoning_agrees_with_the_winner_it_explains():
    """The verdict and its explanation have to be about the same candidate.
    Naming one thing above a paragraph arguing for another is the defect."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            randomize_order=False, swap_and_reconcile=False
        )
    )

    with patch(
        "langevals_langevals.select_best_compare.completion",
        return_value=_mock_completion_response("Candidate B hedges the least.", "B"),
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(_named_entry())

    assert result.label == "detailed"
    assert result.details == "Candidate detailed hedges the least."


# @scenario "Reasoning prose survives the slot translation"
def test_english_article_is_not_mistaken_for_a_slot_label():
    """The letter A is a slot label AND the English article. The article
    reading has to survive intact, even in a sentence where a real slot
    reference is translated alongside it."""
    details = _details_for(
        "A concise answer is better than a rambling one, so B wins.", winner="B"
    )

    assert details == "A concise answer is better than a rambling one, so detailed wins."


# @scenario "Reasoning prose survives the slot translation"
def test_letter_that_is_not_a_slot_in_this_call_is_left_alone():
    """Only the slots THIS call presented are translated. Three candidates
    means slots A, B and C, so a "D" in the prose is somebody's initial, a
    grade, or a hallucination, never a candidate."""
    details = _details_for("D and Z were never on the table; C wins.")

    assert details == "D and Z were never on the table; thorough wins."


# @scenario "Reasoning prose survives the slot translation"
def test_reasoning_without_slot_references_is_returned_unchanged():
    reasoning = "Both replies cover the tradeoff, but the second grounds it."

    assert _details_for(reasoning) == reasoning


# @scenario "Reasoning prose survives the slot translation"
def test_quoted_single_letter_is_left_alone():
    """A lone quoted letter is quoted material, most often a multiple-choice
    answer, rather than a reference to that slot."""
    details = _details_for('C answered "B", which matches the reference.')

    assert details == 'thorough answered "B", which matches the reference.'


# @scenario "Reasoning prose survives the slot translation"
def test_letter_glued_into_a_longer_name_is_left_alone():
    """A judge comparing code writes about C++ and C#. The letter there is
    part of a name, and rewriting it inside one produces prose no reader can
    make sense of."""
    details = _details_for(
        "C answers in C++ and C#, which the question asked for; B answers in "
        "Python."
    )

    assert details == (
        "thorough answers in C++ and C#, which the question asked for; "
        "detailed answers in Python."
    )


# @scenario "Reasoning prose survives the slot translation"
def test_backtick_quoted_letter_is_left_alone():
    """Backticks quote as surely as quotation marks do, and a judge weighing
    code answers reaches for them."""
    details = _details_for("C names `C` as the language; B does not.")

    assert details == "thorough names `C` as the language; detailed does not."


# @scenario "A bare slot letter is translated only where it cannot be an article"
def test_bare_slot_letters_are_translated_in_verb_and_comparison_contexts():
    """The reasoning that surfaced this defect, verbatim in shape: a bare
    letter in front of a verb, and two more drawn into a comparison."""
    details = _details_for(
        "C is more complete than A (A has a good concrete example but is "
        "slightly narrower) and far more informative than B."
    )

    assert details == (
        "thorough is more complete than plain (plain has a good concrete "
        "example but is slightly narrower) and far more informative than "
        "detailed."
    )


# @scenario "A bare slot letter is translated only where it cannot be an article"
def test_preposition_led_comparison_translates_the_bare_letter():
    """"Compared with A" is how a judge names the candidate it weighed the
    winner against, and it reached three rows in ten of a real run. The
    letter has to translate there, exactly as it does after "than"."""
    details = _details_for(
        "It is clear and succinct compared with A (some repetition) and "
        "B (lacks the soft-delete details)."
    )

    assert details == (
        "It is clear and succinct compared with plain (some repetition) and "
        "detailed (lacks the soft-delete details)."
    )


# @scenario "A bare slot letter is translated only where it cannot be an article"
@pytest.mark.parametrize(
    "preposition",
    ["with", "to", "against", "alongside"],
)
def test_every_comparison_preposition_translates_the_bare_letter(preposition):
    details = _details_for(f"C reads better compared {preposition} A.")

    assert details == f"thorough reads better compared {preposition} plain."


# @scenario "Reasoning prose survives the slot translation"
@pytest.mark.parametrize(
    "preposition",
    ["with", "to", "against", "alongside"],
)
def test_title_case_after_a_comparison_preposition_keeps_its_article(preposition):
    """A capitalized article only turns up in title case, and there the word
    after it is capitalized too. That is what keeps the prepositions safe to
    treat as comparisons: "compared with A Concise Answer" is a phrase, not a
    reference to slot A."""
    reasoning = f"C is stronger compared {preposition} A Concise Answer."

    assert _details_for(reasoning) == (
        f"thorough is stronger compared {preposition} A Concise Answer."
    )


# @scenario "Reasoning prose survives the slot translation"
def test_article_after_a_comparison_preposition_is_left_alone_in_lower_case():
    """The article the judge actually writes is lowercase, and a bare
    lowercase letter is prose long before it is a slot. The real slot
    reference in the same sentence still translates."""
    details = _details_for("C is stronger compared with a rambling answer.")

    assert details == "thorough is stronger compared with a rambling answer."


# @scenario "A bare slot letter is translated only where it cannot be an article"
def test_list_and_parenthesised_slot_references_are_translated():
    details = _details_for(
        "A: one-liner. B: hedged. C: complete with an example. The pick is (C)."
    )

    assert details == (
        "plain: one-liner. detailed: hedged. thorough: complete with an "
        "example. The pick is (thorough)."
    )


# @scenario "Each judge pass is translated with the slot order it actually saw"
def test_disagreement_translates_each_pass_with_its_own_slot_mapping():
    """Both passes answered slot "A", but the second pass saw the candidates
    reversed, so its "A" is a different candidate. Each reasoning is
    translated with the mapping of the call that produced it, before the two
    are merged. Reading the reversed pass with the first pass's key would
    attribute its words to the wrong candidate."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )

    # Pass 1 slots: A=plain, B=detailed, C=thorough.
    # Pass 2 slots (reversed): A=thorough, B=detailed, C=plain.
    responses = [
        _mock_completion_response("A is terse but correct.", "A"),
        _mock_completion_response("A is the most complete.", "A"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(_named_entry())

    assert result.status == "skipped"
    assert result.details is not None
    assert "plain is terse but correct." in result.details
    assert "thorough is the most complete." in result.details
    # The two ways of getting the mapping wrong: translating pass 2 with pass
    # 1's slots, or vice versa. Either attributes words to a candidate that
    # never said them.
    assert "thorough is terse but correct." not in result.details
    assert "plain is the most complete." not in result.details


# @scenario "Each judge pass is translated with the slot order it actually saw"
def test_agreeing_reconciliation_keeps_the_translated_reasoning():
    """The confirmation prefix rides on top of an already-translated
    reasoning, so the agreeing path reads in candidate names too."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(randomize_order=False)
    )

    # Slot B is the middle of an odd-length list, so it is the same candidate
    # in both directions: a genuine agreement on "detailed".
    responses = [
        _mock_completion_response("Candidate B is the most complete.", "B"),
        _mock_completion_response("B still wins with the order reversed.", "B"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(_named_entry())

    assert result.label == "detailed"
    assert result.details is not None
    assert "Candidate detailed is the most complete." in result.details
    assert "Candidate B" not in result.details


def test_disagreement_details_may_blame_order_when_the_judge_is_deterministic():
    """At temperature 0 the reversed call differs ONLY in candidate order,
    so attributing the flip to order is a claim the run actually supports."""
    evaluator = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(
            model="openai/gpt-4.1", temperature=0.0, randomize_order=False
        )
    )
    entry = _make_entry(num_candidates=3, row_index=0)

    responses = [
        _mock_completion_response("variant_0 is more concise", "A"),
        _mock_completion_response("variant_2 covers more ground", "A"),
    ]
    with patch(
        "langevals_langevals.select_best_compare.completion",
        side_effect=responses,
    ), patch(
        "langevals_langevals.select_best_compare.completion_cost",
        return_value=0.0001,
    ):
        result = evaluator.evaluate(entry)

    assert result.details is not None
    assert "changed with candidate order" in result.details
