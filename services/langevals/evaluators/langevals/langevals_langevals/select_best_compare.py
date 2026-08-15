"""
Comparison: the native LLM-as-judge preference evaluator.

Given 2+ candidate outputs (from different EvaluationsV3 target columns) and
an optional golden reference, asks an LLM judge to pick the single best
candidate, with deterministic candidate-order shuffling (seeded by
`row_index`) for position-bias mitigation. By default (`swap_and_reconcile`),
each row is judged twice, once in that shuffled order and once with the order
fully reversed. A disagreement between the two verdicts leaves the row with no
winner, which is neither a tie nor either individual call taken on trust.

Two candidates is not a special case. This evaluator is the only comparison
judge offered, superseding the two-slot `langevals/pairwise_compare` (#5100),
which stays runnable but hidden so pre-merge experiments and monitors keep
working.

Issue:        https://github.com/langwatch/langwatch/issues/5101
Parent epic:  https://github.com/langwatch/langwatch/issues/5099
BDD spec:     specs/experiments/comparison.feature
"""

import json
import os
import random
import re
from typing import Literal, Optional, cast

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluationResultSkipped,
    EvaluatorEntry,
    LLMEvaluatorSettings,
    Money,
    SingleEvaluationResult,
)
from litellm import Choices, Message, completion
from litellm.cost_calculator import completion_cost
from litellm.files.main import ModelResponse
from pydantic import BaseModel, Field


# Placeholders are substituted literally (not str.format), so a stray
# brace in a customized prompt is passed through verbatim rather than
# raising KeyError. Tool-call schema below drives the response shape,
# so no JSON example is embedded.
#
# Deliberately generic — no correctness/completeness/style rubric baked
# in. The judge decides what "better" means for the task at hand rather
# than being forced onto a fixed axis set; users needing a specific
# rubric edit `settings.prompt` (kept as an escape hatch, not the
# default chrome).
DEFAULT_SELECT_BEST_PROMPT = """\
Pick the best of N candidate replies to the task.

Task:       {input}
Reference:  {golden}

Candidates:
{candidates}

Look across the candidates and decide which one is the best reply.
Briefly explain WHY it's better than the others, then pick the winning
slot label. Use "tie" only when no candidate is clearly better.
"""

# Used when has_golden_answer is False (parity with #5378 pairwise). No
# reference answer exists, so the judge compares the candidates directly
# on their own merits. Kept as its own template rather than blanking the
# {golden} slot — a prompt that says "Reference: " with nothing after it
# confuses the judge more than dropping the framing entirely.
DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN = """\
Pick the best of N candidate replies to the task — there is no reference
answer, so compare them on their own merits.

Task:  {input}

Candidates:
{candidates}

Look across the candidates and decide which one is the best reply.
Briefly explain WHY it's better than the others, then pick the winning
slot label. Use "tie" only when no candidate is clearly better.
"""

# A reference answer but no task context — used when the row has a golden
# answer but no input. Drops the {input}/Task framing entirely rather than
# leaving a "Task: " line with nothing after it.
DEFAULT_SELECT_BEST_PROMPT_GOLDEN_NO_INPUT = """\
Pick the best of N candidate replies.

Reference:  {golden}

Candidates:
{candidates}

Compare each candidate against the reference answer and decide which one
is closest. Briefly explain WHY it's better than the others, then pick the
winning slot label. Use "tie" only when no candidate is clearly better.
"""

# Neither a reference answer nor task context — compare on merits with no
# framing for either, dropping both the Task and Reference lines.
DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN_NO_INPUT = """\
Pick the best of N candidate replies — there is no task description or
reference answer, so compare them on their own merits.

Candidates:
{candidates}

Look across the candidates and decide which one is the best reply.
Briefly explain WHY it's better than the others, then pick the winning
slot label. Use "tie" only when no candidate is clearly better.
"""

# Every shipped default judge prompt, one per (golden x input) presence combo.
# Kept VERBATIM in sync with the four JUDGE_PROMPT_* constants in the frontend
# ComparisonConfigForm.tsx. Used to detect an untouched default so the runtime
# can swap in the one that matches what the row actually provides; a hand-tuned
# prompt matches none of them and is passed through unchanged.
ALL_DEFAULT_SELECT_BEST_PROMPTS = [
    DEFAULT_SELECT_BEST_PROMPT,
    DEFAULT_SELECT_BEST_PROMPT_GOLDEN_NO_INPUT,
    DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN,
    DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN_NO_INPUT,
]


def _pick_default_select_best_prompt(*, has_golden: bool, has_input: bool) -> str:
    """The default judge prompt for a given (golden x input) presence combo —
    the prompt adapts to what the row actually gives it (a reference answer,
    task context, both, or neither)."""
    if has_golden:
        return (
            DEFAULT_SELECT_BEST_PROMPT
            if has_input
            else DEFAULT_SELECT_BEST_PROMPT_GOLDEN_NO_INPUT
        )
    return (
        DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN
        if has_input
        else DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN_NO_INPUT
    )


class CandidateInput(BaseModel):
    """One candidate output to be judged."""

    id: str
    output: str
    cost: Optional[float] = None
    duration: Optional[float] = None


class SelectBestCompareEntry(EvaluatorEntry, allow_extra=True):
    input: Optional[str] = None
    golden: Optional[str] = None
    candidates: list[CandidateInput] = []

    # Deterministic seed for candidate-order shuffling. When None the
    # shuffle falls back to seed 0 (stable across rows), so callers that
    # want per-row position-bias mitigation should pass the actual row
    # index rather than leaving it unset.
    row_index: Optional[int] = None


class SelectBestCompareSettings(LLMEvaluatorSettings):
    prompt: str = Field(
        default=DEFAULT_SELECT_BEST_PROMPT,
        description=(
            "Judge prompt template. Placeholders: {input}, {golden}, "
            "{candidates} (a pre-rendered bulleted list with slot labels "
            "and optional per-candidate metrics)."
        ),
    )
    has_golden_answer: bool = Field(
        default=False,
        description=(
            "Compare each candidate against a reference answer. Turn off "
            "to have the judge compare the candidates directly on their "
            "own merits, with no reference answer involved."
        ),
    )
    randomize_order: bool = Field(
        default=True,
        description=(
            "Shuffle candidate order per row (deterministically, seeded "
            "by row_index) before presenting them to the judge. Reduces "
            "position bias when the judge is called once per row."
        ),
    )
    allow_tie: bool = Field(
        default=True,
        description="Allow the judge to return 'tie' when candidates are equivalent",
    )
    include_metrics: list[Literal["cost", "duration"]] = Field(
        default=[],
        description="Per-candidate metrics to inject into the judge prompt",
    )
    temperature: float = Field(
        default=0.0,
        description="Sampling temperature for the judge call. Lower is more deterministic.",
    )
    swap_and_reconcile: bool = Field(
        default=True,
        description=(
            "Check each row twice, the second time with the candidate order "
            "reversed, and record no result for that row when the two "
            "disagree — rather than a tie, which would claim the candidates "
            "are equally good. Doubles judge-call cost per row (literature: "
            "swapping candidate order alone flips 10-30% of verdicts on "
            "contested rows)."
        ),
    )


class SelectBestCompareResult(EvaluationResult):
    score: float = Field(
        default=0.5,
        description="1.0 when a winner was picked, 0.5 for tie",
    )
    label: Optional[str] = Field(
        default=None,
        description=(
            "The winning candidate id (matches the id supplied in "
            "entry.candidates), or 'tie'."
        ),
    )
    details: Optional[str] = Field(
        default=None,
        description="Judge reasoning text",
    )


# The class docstring below is emitted verbatim as the evaluator's
# `description` — the copy on its Add Evaluator card. Keep it customer-facing:
# no module names, no deprecation history, no judge-call mechanics. The
# engineering story (why pairwise_compare was folded in here, why shuffling
# replaced swap-and-confirm) belongs in the module docstring, not the card.
class SelectBestCompareEvaluator(
    BaseEvaluator[
        SelectBestCompareEntry, SelectBestCompareSettings, SelectBestCompareResult
    ]
):
    """
    Compare two or more candidate outputs and pick the best one, optionally
    against a reference answer. The judge sees every candidate at once and
    explains why the winner is better. Candidate order is shuffled so that a
    candidate's position never sways the verdict, and by default each row is
    checked twice — once more with the order reversed — recording no result
    for that row when the two checks disagree, rather than guessing.
    """

    name = "Comparison"
    category = "quality"
    env_vars = []
    default_settings = SelectBestCompareSettings()
    is_guardrail = False

    def evaluate(self, entry: SelectBestCompareEntry) -> SingleEvaluationResult:
        os.environ["AZURE_API_VERSION"] = "2023-12-01-preview"
        if self.env:
            for key, env in self.env.items():
                os.environ[key] = env

        candidates = [c for c in entry.candidates if c.output]
        if len(candidates) < 2:
            return EvaluationResultSkipped(
                details=(
                    f"N-way compare needs at least 2 candidates with non-empty "
                    f"outputs (got {len(candidates)})"
                )
            )

        if self.settings.randomize_order:
            seed = entry.row_index if entry.row_index is not None else 0
            ordered = list(candidates)
            random.Random(seed).shuffle(ordered)
        else:
            ordered = list(candidates)

        verdict = (
            self._reconcile(entry, ordered)
            if self.settings.swap_and_reconcile
            else self._judge(entry, ordered)
        )

        winner_id = verdict["winner"]

        # `is not None` (not a truthiness check) so a genuine $0.0 cost, a
        # real free judge call, is preserved as Money(0.0) rather than being
        # coerced to None. cost stays None only when completion_cost actually
        # failed to compute (verdict["cost"] is None).
        cost = (
            Money(amount=verdict["cost"], currency="USD")
            if verdict.get("cost") is not None
            else None
        )

        # No winner at all: reconciliation found the verdict was order-
        # dependent, whatever `allow_tie` says, so there is nothing to report.
        # This is skipped rather than scored: `score=1.0` would read as a win
        # for `label=None`, and `score=0.5` would claim a tie the run never
        # established. An absent verdict must contribute no evidence either
        # way.
        #
        # The judge calls were still made and still billed, so the cost rides
        # along: an inconclusive row is the most expensive kind there is (two
        # calls instead of one), and dropping its spend understates exactly the
        # rows a user would want to know cost them the most.
        if winner_id is None:
            return EvaluationResultSkipped(
                details=verdict["reasoning"],
                cost=cost,
            )

        score = 0.5 if winner_id == "tie" else 1.0

        return SelectBestCompareResult(
            score=score,
            label=winner_id,
            details=verdict["reasoning"],
            cost=cost,
        )

    def _effective_temperature(self) -> float:
        """
        gpt-5-family models require temperature=1.0 and reject any other
        value; every other model/provider gets the user's configured value
        (default 0.0). `drop_params=True` at the call site tells litellm to
        silently strip the param for any other model that doesn't support it,
        rather than raising. Mirrors llm_answer_match.py's
        `model_to_dspy_lm`.

        Shared with `_reconcile`, which needs to know whether the judge was
        actually pinned before it attributes a flipped verdict to anything.
        """
        return 1.0 if "gpt-5" in self.settings.model else self.settings.temperature

    def _reconcile(
        self,
        entry: SelectBestCompareEntry,
        ordered: list[CandidateInput],
    ) -> dict:
        """
        Swap-and-reconcile: call `_judge` twice, once across `ordered` as
        given and once with that same list fully reversed, and leave the row
        with no winner when the two verdicts disagree rather than trusting
        either individual call. `_judge` builds its own slot-to-candidate
        mapping from whatever list it's handed and translates the judge's
        slot pick back to the candidate's real id, so the reversed call
        "just works" through that existing translation logic.

        Slot A of the reversed call is a different candidate from slot A of
        the first, so both verdicts arrive with their reasoning already
        translated against the mapping of the call that produced it. The
        merging below only ever concatenates text that already names real
        candidates.

        Returns the same `{"winner", "reasoning", "cost"}` shape `_judge`
        returns, so callers don't need to know which path ran.
        """
        verdict1 = self._judge(entry, ordered)
        verdict2 = self._judge(entry, list(reversed(ordered)))

        winner1 = verdict1["winner"]
        winner2 = verdict2["winner"]
        cost1 = verdict1.get("cost")
        cost2 = verdict2.get("cost")

        # Cost stays None only when BOTH calls genuinely failed to compute a
        # cost (mirrors the "cost stays None only when completion_cost
        # genuinely failed" behavior in evaluate()'s Money(...) construction).
        # A single failed call still contributes the other call's real cost.
        total_cost = (
            None if cost1 is None and cost2 is None else (cost1 or 0.0) + (cost2 or 0.0)
        )

        # One unusable answer is not a disagreement. Reading it as one would
        # tell the reader the candidates could not be separated, when what
        # actually happened is that the judge never answered; and two unusable
        # answers would agree with each other and report a winner of None as
        # though it had been confirmed twice.
        if verdict1.get("unanswered") or verdict2.get("unanswered"):
            unusable = verdict1 if verdict1.get("unanswered") else verdict2
            return {
                "winner": None,
                "unanswered": True,
                "reasoning": unusable["reasoning"],
                "cost": total_cost,
            }

        if winner1 == winner2:
            # Same winner both times (including both "tie") — agreement.
            #
            # Phrased to match what actually varied, for the same reason the
            # disagreement branch below is. At a pinned temperature the only
            # difference between the two calls was candidate order, so
            # surviving it is a statement about order. Above 0 the sampling
            # varied too — which makes the agreement STRONGER, not weaker, but
            # it is no longer a claim about order specifically.
            confirmation = (
                "Confirmed under order swap."
                if self._effective_temperature() == 0.0
                else "Confirmed on a second call with the candidate order reversed."
            )
            return {
                "winner": winner1,
                "reasoning": f"{confirmation}\n\n{verdict1['reasoning']}",
                "cost": total_cost,
            }

        # Disagreement: the verdict flipped when candidate order flipped.
        # Don't guess which direction was right — say so, and let the caller
        # decide what an unresolvable row means for them.
        # What changed between the two calls decides what we may blame.
        #
        # At temperature 0 the reversed call differs ONLY in candidate order,
        # so "the verdict changed with candidate order" is a claim the run
        # supports. Above 0 — which gpt-5-family models force, and they are
        # the usual judge here — the two calls differ in candidate order AND
        # in sampling, so the same sentence names a cause that was never
        # isolated. The finding is identical either way: this row does not
        # establish a winner. Only the explanation has to be earned.
        pinned = self._effective_temperature() == 0.0
        cause = (
            "The verdict changed with candidate order."
            if pinned
            else (
                "The verdict did not survive being asked again with the "
                "candidate order reversed. This judge does not run at a fixed "
                "temperature, so the disagreement is not necessarily caused "
                "by the order."
            )
        )
        label = "Order-sensitive verdict" if pinned else "Unreproducible verdict"
        # Laid out as blocks rather than one paragraph. Each pass writes prose
        # carrying its own commas, semicolons and parentheses, so joining two
        # of them with more of the same buried the one thing the reader needs
        # first — where one pass's account ends and the other's begins — under
        # a wall of nested punctuation. The headline states the finding, each
        # pass gets its own block, and the caveat lands last.
        details = (
            f"{label}: this row does not establish a winner.\n\n"
            f"Original order picked {winner1}:\n{verdict1['reasoning']}\n\n"
            f"Reversed order picked {winner2}:\n{verdict2['reasoning']}\n\n"
            f"{cause}"
        )

        # No winner, regardless of `allow_tie`.
        #
        # "They tied" and "we could not get a stable answer" are different
        # claims, and only the second one is true here. The distinction is not
        # cosmetic: a tie is real evidence, scored 0.5/0.5 into the pairwise
        # tally that feeds the Bradley-Terry fit, so returning one from a
        # reconciliation failure feeds the ranking a measurement the run never
        # made. An absent verdict has to contribute nothing.
        #
        # This used to hinge on `allow_tie`, which made the evaluator state the
        # objection itself and then act against it on the default path: with
        # ties disabled it correctly refused to invent one, and with ties
        # enabled — the default — it invented one anyway.
        #
        # Deliberately NOT "fall back to winner1" either: the disagreement IS
        # the finding. Order-sensitivity is exactly what swap_and_reconcile
        # exists to detect, so returning the original-order winner would hand
        # back the artefact just demonstrated, silently.
        return {
            "winner": None,
            "reasoning": details,
            "cost": total_cost,
        }

    def _judge(
        self,
        entry: SelectBestCompareEntry,
        ordered: list[CandidateInput],
    ) -> dict:
        """
        Run one judge call across N candidates. Returns the winner's
        ORIGINAL id (not the slot label) and reasoning that names the same
        ids. Slot labels are alphabetic (A, B, C, ...) so the judge can pick
        by slot and we translate both the pick and the explanation of it.
        """
        slot_to_candidate = {
            _slot_label(i): cand for i, cand in enumerate(ordered)
        }
        candidates_block = self._render_candidates_block(slot_to_candidate)

        # When the user hasn't customized the prompt (it still matches one of
        # the four shipped defaults, trimmed), swap in the default that matches
        # what THIS row actually provides — a reference answer (has_golden), task
        # context (a non-empty input), both, or neither. The framing for a
        # missing axis is dropped entirely rather than left as an empty
        # "Reference: " / "Task: " line, which confuses the judge more. A
        # hand-tuned prompt matches none of the defaults and passes through
        # unchanged.
        #
        # BOTH axes are resolved per row. Golden is opt-in at config time, but
        # opting in does not promise every row actually carries a reference —
        # a dataset with a blank expected_output on some rows would otherwise
        # render "Reference:" followed by nothing, which is the very thing the
        # golden-aware framing exists to avoid. Config says "compare against a
        # reference"; the row says whether there is one.
        effective_prompt = self.settings.prompt
        prompt_is_default = any(
            effective_prompt.strip() == default.strip()
            for default in ALL_DEFAULT_SELECT_BEST_PROMPTS
        )
        if prompt_is_default:
            has_input = bool(entry.input and str(entry.input).strip())
            has_golden = self.settings.has_golden_answer and bool(
                entry.golden and str(entry.golden).strip()
            )
            effective_prompt = _pick_default_select_best_prompt(
                has_golden=has_golden,
                has_input=has_input,
            )
            # The include_metrics toggles are a no-op unless the judge is
            # actually told to weigh what they add to the candidate block —
            # otherwise cost=$.../duration=...s just sits there as
            # unexplained noise the judge may or may not notice. Only
            # appended when metrics are actually on, and only for the
            # shipped defaults; a hand-tuned prompt is never modified.
            if self.settings.include_metrics:
                effective_prompt += (
                    "\n\nSome candidates above are annotated with cost "
                    "and/or duration. Factor these into your decision, "
                    "preferring a cheaper or faster candidate only when "
                    "quality is comparable."
                )

        # `str.format` raises KeyError on any stray brace the user's custom
        # prompt happens to contain (e.g. a pasted JSON example or a rubric
        # like "score out of {10}"), surfacing as an opaque evaluator error
        # instead of a working evaluation. Mirrors pairwise_compare's fix for
        # the same hazard: literal substitution for the slots we know about;
        # anything else (including unmatched braces) passes through verbatim.
        rendered_prompt = effective_prompt
        for key, val in {
            "input": entry.input or "",
            "golden": entry.golden or "",
            "candidates": candidates_block,
        }.items():
            rendered_prompt = rendered_prompt.replace("{" + key + "}", str(val))

        slot_labels = list(slot_to_candidate.keys())
        winner_enum = slot_labels + (["tie"] if self.settings.allow_tie else [])

        effective_temperature = self._effective_temperature()

        # The system message carries the rules that exist because of how the
        # candidates are PRESENTED, anonymized and in an order we chose,
        # rather than anything about the task. It lives here and not in the
        # prompt templates for two reasons: `settings.prompt` is a user escape
        # hatch, and a hand-tuned prompt still gets anonymized slots, so the
        # rules that make them readable cannot be something the user can
        # delete; and the templates are mirrored in the config form and in two
        # generated catalogs, so every word added to them is a fourfold drift
        # surface.
        #
        # "Write every slot as Candidate A" is the upstream half of
        # `_translate_slot_references` below. A bare "A" is also the English
        # article, so the translation can only rewrite it where the
        # surrounding words rule the article out, and no follower list can
        # cover an open verb vocabulary ("A strikes the best balance..." is
        # left standing). A judge that always writes the noun in front never
        # produces the ambiguous form in the first place, and "Candidate A"
        # translates unconditionally. The guard stays as the fallback for the
        # bare letters that still get through: over 24 rows of real gpt-5-mini
        # output the rule took responses carrying a bare letter from 24 to 9,
        # and bare letter tokens from 53 to 11, which is a much smaller surface
        # for the guard to gamble on rather than none at all.
        #
        # Given once, here, and deliberately not repeated on the `reasoning`
        # field below. Restating it there raised compliance slightly and
        # lengthened the reasoning by a third, because a judge told twice to
        # name slots starts enumerating every candidate. The reasoning is
        # customer-facing prose and the schema already asks for brevity.
        response = completion(
            model=self.settings.model,
            temperature=effective_temperature,
            drop_params=True,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an impartial judge picking the best of "
                        "several candidate outputs. Reason briefly, then "
                        "pick the winning slot label using the provided "
                        "function call. Judge the candidates' content only, "
                        "ignore the order in which they are presented. "
                        "In your reasoning write every slot as "
                        '"Candidate A", "Candidate B" and so on, never as a '
                        "bare letter; the winner field still takes the bare "
                        "label."
                    ),
                },
                {"role": "user", "content": rendered_prompt},
            ],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "select_best_verdict",
                        "description": (
                            "Record the select-best verdict. Reason first, "
                            "then pick the winning slot label."
                        ),
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "reasoning": {
                                    "type": "string",
                                    "description": (
                                        "Brief explanation of why the "
                                        "winning candidate is the best "
                                        "reply — keep it brief."
                                    ),
                                },
                                "winner": {
                                    "type": "string",
                                    "enum": winner_enum,
                                    "description": (
                                        "The winning slot label. Use 'tie' "
                                        "only when no candidate clearly wins."
                                    ),
                                },
                            },
                            "required": ["reasoning", "winner"],
                        },
                    },
                }
            ],
            tool_choice={
                "type": "function",
                "function": {"name": "select_best_verdict"},
            },  # type: ignore
        )

        response = cast(ModelResponse, response)
        choice = cast(Choices, response.choices[0])

        # Read the cost before reading the answer. The call was made and billed
        # whatever came back inside it, so an answer we cannot use still has to
        # carry its price to the row.
        try:
            call_cost = completion_cost(completion_response=response)
        except Exception:
            call_cost = None

        # A forced `tool_choice` is a request, not a guarantee. Providers
        # occasionally answer with no tool call, or with one whose arguments
        # are unreadable or carry no `winner`; two of roughly 200 live calls
        # did while dogfooding. Each of those is the judge failing to answer,
        # which is a verdict-shaped outcome the reader can act on, so it is
        # reported as no verdict rather than raised as an evaluator error.
        tool_calls = getattr(cast(Message, choice.message), "tool_calls", None)
        if not tool_calls:
            return _unanswered("returned no answer to read", call_cost)

        try:
            raw_arguments = tool_calls[0].function.arguments
        except AttributeError:
            return _unanswered("returned no answer to read", call_cost)

        try:
            arguments = json.loads(raw_arguments)
        except (TypeError, ValueError):
            return _unanswered("returned an answer that could not be read", call_cost)

        # A present-but-empty `winner` is the same non-answer as an absent one:
        # `{"winner": null}` names nobody. It is checked here rather than left
        # to the slot lookup below, whose fallback deliberately degrades an
        # unrecognised slot LETTER to a real candidate — a fallback that would
        # otherwise turn "the judge named no one" into "candidate A won".
        displayed = arguments.get("winner") if isinstance(arguments, dict) else None
        if not isinstance(displayed, str) or not displayed.strip():
            return _unanswered("answered without naming a winner", call_cost)
        if displayed == "tie":
            winner_id = "tie"
        elif displayed in slot_to_candidate:
            winner_id = slot_to_candidate[displayed].id
        else:
            # Defensive fallback: not every provider strictly enforces the
            # tool-call `enum`, so the judge can return a `winner` slot we
            # never presented (e.g. "D" when only slots A/B/C exist). Rather
            # than crash with a KeyError on the slot lookup, degrade
            # gracefully to the first slot — mirrors legacy pairwise_compare,
            # whose final else maps any unexpected winner onto a real slot
            # instead of raising. There are always >= 2 candidates here (the
            # <2 case skips earlier), so slot "A" always exists and the row
            # still yields a processed result naming a real candidate.
            winner_id = slot_to_candidate[_slot_label(0)].id

        # `reasoning` is free text in the tool schema, and a provider that does
        # not strictly enforce the schema can put an object, a list or a number
        # there. Anything that is not text is the same as no explanation: it
        # cannot be read by the customer, and it cannot be slot-translated
        # below, where a non-string would raise instead of returning a verdict.
        explanation = arguments.get("reasoning")
        if not isinstance(explanation, str) or not explanation.strip():
            explanation = "The judge gave no explanation."

        # The judge argues in terms of the slot labels it was shown, so the
        # reasoning is translated before it leaves `_judge`, with the same
        # mapping the winner above is translated with. Slot order differs per
        # call (`_reconcile` reverses it for the second one), so a reasoning
        # that travelled any further before being translated would be read
        # against the wrong candidates.
        return {
            "winner": winner_id,
            "reasoning": _translate_slot_references(explanation, slot_to_candidate),
            "cost": call_cost,
        }

    def _render_candidates_block(
        self, slot_to_candidate: dict[str, CandidateInput]
    ) -> str:
        """
        Render the bulleted candidate list for the {candidates} slot in
        the judge prompt, with optional cost/latency metrics.
        """
        lines: list[str] = []
        for slot, cand in slot_to_candidate.items():
            metric_parts: list[str] = []
            if "cost" in self.settings.include_metrics and cand.cost is not None:
                metric_parts.append(f"cost=${cand.cost:.6f}")
            if (
                "duration" in self.settings.include_metrics
                and cand.duration is not None
            ):
                metric_parts.append(f"duration={cand.duration:.3f}s")
            suffix = f"  [{', '.join(metric_parts)}]" if metric_parts else ""
            lines.append(f"- {slot}: {cand.output}{suffix}")
        return "\n".join(lines)


def _unanswered(what_happened: str, cost: float | None) -> dict:
    """
    A judge call that came back without a usable verdict, in the same
    `{"winner", "reasoning", "cost"}` shape a real verdict has, plus the
    `unanswered` marker `_reconcile` reads.

    The marker matters because a `None` winner already means "the two passes
    disagreed", and the two are not the same finding: a disagreement is
    something the row established about the candidates, an unanswered call is
    something that went wrong with the provider. Merging them would report a
    provider slip as evidence the candidates are too close to separate.
    """
    return {
        "winner": None,
        "unanswered": True,
        "reasoning": (
            f"The judge {what_happened}, so this row has no verdict. "
            "The call was still made and billed."
        ),
        "cost": cost,
    }


def _slot_label(index: int) -> str:
    """
    Map a candidate index to an alphabetic slot label: 0->A, 1->B, ...,
    25->Z, 26->AA, 27->AB, etc. We use slot labels rather than the
    candidate's original id so the judge can't be influenced by names
    when shuffled.
    """
    if index < 0:
        raise ValueError("Slot index must be non-negative")
    letters = ""
    n = index
    while True:
        letters = chr(ord("A") + (n % 26)) + letters
        n = n // 26 - 1
        if n < 0:
            break
    return letters


# A slot label, optionally introduced by the noun the judge puts in front of
# it. The lookaround pair keeps the label a word of its own, so a letter
# inside a longer token ("v0", "A_1") is never a match.
_SLOT_REFERENCE_RE = re.compile(
    r"(?<![A-Za-z0-9_])"
    r"(?:(?P<prefix>candidates?|slots?|options?)(?P<gap>[ \t]+))?"
    r"(?P<slot>[A-Za-z]{1,2})"
    r"(?![A-Za-z0-9_])",
    re.IGNORECASE,
)

# Slot labels that are also ordinary English: the article "A", the pronoun
# "I", and the two-letter labels a run of 27+ candidates reaches. Left alone
# unless the surrounding words rule the English reading out.
_WORD_LIKE_SLOT_LABELS = frozenset(
    {
        "A",
        "AI",
        "AM",
        "AN",
        "AS",
        "AT",
        "BE",
        "BY",
        "DO",
        "GO",
        "HE",
        "I",
        "ID",
        "IF",
        "IN",
        "IS",
        "IT",
        "ME",
        "MY",
        "NO",
        "OF",
        "OK",
        "ON",
        "OR",
        "SO",
        "TO",
        "UP",
        "US",
        "WE",
    }
)

# Words that can follow a slot label but never the article "a" or the pronoun
# "I". Auxiliaries, coordinators and third-person verbs only: a past
# participle ("a covered case") and an adverb ("a slightly narrower reply")
# both read fine after an article, so neither proves anything. Modals that
# double as nouns ("a must", "a can") are left out for the same reason.
_NON_ARTICLE_FOLLOWERS = frozenset(
    {
        # Auxiliaries and copulas.
        "is",
        "isn't",
        "was",
        "wasn't",
        "are",
        "aren't",
        "were",
        "weren't",
        "has",
        "hasn't",
        "have",
        "haven't",
        "had",
        "hadn't",
        "does",
        "doesn't",
        "do",
        "don't",
        "did",
        "didn't",
        "cannot",
        "can't",
        "won't",
        "would",
        "wouldn't",
        "could",
        "couldn't",
        "should",
        "shouldn't",
        # Coordinators and discourse markers.
        "and",
        "or",
        "but",
        "nor",
        "however",
        "therefore",
        "then",
        "though",
        "although",
        # Adverbs that cannot introduce a noun phrase. "Merely", "clearly" and
        # friends can ("a clearly better reply"), so they are not here.
        "again",
        "also",
        "instead",
        "only",
        # Third-person verbs a judge reaches for when comparing replies.
        "adds",
        "addresses",
        "aligns",
        "answers",
        "appears",
        "beats",
        "captures",
        "cites",
        "comes",
        "contains",
        "covers",
        "delivers",
        "describes",
        "discusses",
        "drops",
        "elaborates",
        "explains",
        "fails",
        "follows",
        "gets",
        "gives",
        "handles",
        "hedges",
        "ignores",
        "includes",
        "lacks",
        "lists",
        "loses",
        "matches",
        "mentions",
        "misses",
        "names",
        "notes",
        "offers",
        "omits",
        "presents",
        "provides",
        "quotes",
        "ranks",
        "reads",
        "remains",
        "repeats",
        "restates",
        "says",
        "scores",
        "seems",
        "skips",
        "stays",
        "sticks",
        "summarizes",
        "ties",
        "tracks",
        "uses",
        "wanders",
        "wins",
    }
)

# Comparisons the judge draws against another candidate. What follows one of
# these is a candidate, not the start of a noun phrase.
#
# The prepositions carry as much of this as the verbs do: "compared with A",
# "compared to A", "measured against A" and "set alongside A" are the judge's
# ordinary way of naming the candidate it weighed the winner against. They are
# safe for the same reason "than" is: a capitalized article after one of them
# only happens in title case, which the next-word check below rules out.
_COMPARATIVE_PRECEDERS = frozenset(
    {
        "against",
        "alongside",
        "beats",
        "chose",
        "outperforms",
        "over",
        "picked",
        "prefers",
        "than",
        "to",
        "unlike",
        "versus",
        "vs",
        "with",
    }
)

# Characters that close a reference when they come immediately after the
# label. Immediacy is the whole guard: "A," ends a reference, while
# "A 'concise' reply" is an article in front of a quoted adjective.
_CLOSING_AFTER_SLOT = ",.;:!?)]}\n\r"

# A lone letter in quotes is quoted material, most often a multiple-choice
# answer of "B", rather than a reference to slot B. Backticks count: a judge
# comparing code writes `C` about the language.
_OPENING_QUOTES = "\"'“‘`"
_CLOSING_QUOTES = "\"'”’`"

# Punctuation that can follow a bare label without binding to it. Anything
# else glued to the letter makes it part of a name rather than a reference:
# "C++", "C#" and "B-side" are one token to a reader, and rewriting the letter
# inside one produces "plain++", which is worse than the letter left standing.
_UNBOUND_AFTER_SLOT = _CLOSING_AFTER_SLOT + " \t'’" + _CLOSING_QUOTES

_NEXT_WORD_RE = re.compile(r"[A-Za-z'’]+")
_PREVIOUS_WORD_RE = re.compile(r"([A-Za-z'’]+)[^A-Za-z]*$")


def _translate_slot_references(
    reasoning: str, slot_to_candidate: dict[str, CandidateInput]
) -> str:
    """
    Rewrite the slot labels in a judge's reasoning into the candidate ids
    they stand for, using the mapping of the call that produced it.

    The judge sees anonymized slots so a candidate's name cannot sway it,
    which leaves it explaining a verdict in terms of "A", "B" and "C" that
    the reader has no key to. This is the key.

    The prose is customer-visible and comes first: a substitution that
    corrupts a sentence is worse than a slot letter left standing, so a label
    is only translated where it cannot be read as ordinary English. "A
    concise answer is better" keeps its article. Substitution happens in one
    pass per match, so a candidate id that happens to look like a slot label
    is never translated a second time.
    """
    if not reasoning:
        return reasoning

    def substitute(match: re.Match[str]) -> str:
        candidate = slot_to_candidate.get(match.group("slot").upper())
        if candidate is None or not _reads_as_slot_reference(reasoning, match):
            return match.group(0)
        prefix = match.group("prefix") or ""
        gap = match.group("gap") or ""
        return f"{prefix}{gap}{candidate.id}"

    return _SLOT_REFERENCE_RE.sub(substitute, reasoning)


def _reads_as_slot_reference(text: str, match: re.Match[str]) -> bool:
    """Whether a slot-shaped token refers to a candidate rather than being an
    ordinary word that happens to be one letter long."""
    token = match.group("slot")
    start, end = match.span("slot")
    word_like = token.upper() in _WORD_LIKE_SLOT_LABELS

    if match.group("prefix"):
        # "Candidate C" / "candidate c": the noun in front settles it, unless
        # the label is lowercase and a word in its own right. "The candidate a
        # reader would pick" is about a reader, not about slot A.
        if not (word_like and not token.isupper()):
            return True
    elif not token.isupper():
        # A bare lowercase letter is prose far more often than a slot label.
        return False
    elif _is_quoted(text, start, end):
        return False
    elif _binds_to_what_follows(text, end):
        return False
    elif not word_like:
        return True

    return _english_reading_is_ruled_out(text, start, end)


def _binds_to_what_follows(text: str, end: int) -> bool:
    """Whether the character right after a label glues it into a longer name,
    as the plus signs do in "C++"."""
    return end < len(text) and text[end] not in _UNBOUND_AFTER_SLOT


def _english_reading_is_ruled_out(text: str, start: int, end: int) -> bool:
    """Whether the words around a slot label make the English word reading of
    it impossible."""
    after = text[end:]
    if after == "" or after[0] in _CLOSING_AFTER_SLOT:
        return True
    if after[:2].lower() in ("'s", "’s"):
        return True

    next_word = _next_word(after)
    if _normalize_apostrophe(next_word) in _NON_ARTICLE_FOLLOWERS:
        return True

    if _normalize_apostrophe(_previous_word(text[:start])) in _COMPARATIVE_PRECEDERS:
        # "more complete than A (one-liner)". A capitalized word after the
        # label means title case, where an article is capitalized too and the
        # reading is open again.
        return not next_word[:1].isupper()

    return False


def _is_quoted(text: str, start: int, end: int) -> bool:
    before = text[start - 1] if start > 0 else ""
    after = text[end] if end < len(text) else ""
    if not before or not after:
        return False
    return before in _OPENING_QUOTES and after in _CLOSING_QUOTES


def _next_word(after: str) -> str:
    match = _NEXT_WORD_RE.match(after.lstrip(" \t"))
    return match.group(0) if match else ""


def _previous_word(before: str) -> str:
    match = _PREVIOUS_WORD_RE.search(before)
    return match.group(1) if match else ""


def _normalize_apostrophe(word: str) -> str:
    return word.replace("’", "'").lower()
