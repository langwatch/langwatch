"""
Comparison: the native LLM-as-judge preference evaluator.

Given 2+ candidate outputs (from different EvaluationsV3 target columns) and
an optional golden reference, asks an LLM judge to pick the single best
candidate in one judge call, with deterministic candidate-order shuffling
(seeded by `row_index`) for position-bias mitigation.

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
        default=True,
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
    candidate's position never sways the verdict.
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

        verdict = self._judge(entry, ordered)

        winner_id = verdict["winner"]
        score = 0.5 if winner_id == "tie" else 1.0

        return SelectBestCompareResult(
            score=score,
            label=winner_id,
            details=verdict["reasoning"],
            cost=(
                # `is not None` (not a truthiness check) so a genuine $0.0
                # cost — a real, free judge call — is preserved as Money(0.0)
                # rather than being coerced to None. cost stays None only when
                # completion_cost actually failed to compute (verdict["cost"]
                # is None).
                Money(amount=verdict["cost"], currency="USD")
                if verdict.get("cost") is not None
                else None
            ),
        )

    def _judge(
        self,
        entry: SelectBestCompareEntry,
        ordered: list[CandidateInput],
    ) -> dict:
        """
        Run one judge call across N candidates. Returns the winner's
        ORIGINAL id (not the slot label). Slot labels are alphabetic
        (A, B, C, ...) so the judge can pick by slot and we translate.
        """
        slot_to_candidate = {
            _slot_label(i): cand for i, cand in enumerate(ordered)
        }
        candidates_block = self._render_candidates_block(slot_to_candidate)

        # When has_golden_answer is off AND the user hasn't customized the
        # prompt, swap in the golden-free template. Mirrors pairwise's
        # #5378 pattern — the intent is to drop the reference framing
        # entirely, not just leave "Reference: " with a blank slot.
        effective_prompt = self.settings.prompt
        prompt_is_golden_free = (
            not self.settings.has_golden_answer
            and effective_prompt == DEFAULT_SELECT_BEST_PROMPT
        )
        if prompt_is_golden_free:
            effective_prompt = DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN

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

        response = completion(
            model=self.settings.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an impartial judge picking the best of "
                        "several candidate outputs. Reason briefly, then "
                        "pick the winning slot label using the provided "
                        "function call."
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
        arguments = json.loads(
            cast(Message, choice.message).tool_calls[0].function.arguments  # type: ignore
        )

        displayed = arguments["winner"]
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

        try:
            call_cost = completion_cost(completion_response=response)
        except Exception:
            call_cost = None

        return {
            "winner": winner_id,
            "reasoning": arguments["reasoning"],
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
