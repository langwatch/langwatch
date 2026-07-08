"""
N-way Compare: native LLM-as-judge "select best of N" evaluator.

Standalone evaluator, separate from `langevals/pairwise_compare` (#5100) —
shown as its own card in Add Evaluator rather than a mode toggle inside
Pairwise Compare. Given 3+ candidate outputs (from different EvaluationsV3
target columns) and a golden reference, asks an LLM judge to pick the
single best candidate in one judge call, with deterministic candidate-order
shuffling (seeded by `row_index`) for position-bias mitigation.

Issue:        https://github.com/langwatch/langwatch/issues/5101
Parent epic:  https://github.com/langwatch/langwatch/issues/5099
BDD spec:     specs/experiments/select-best-nway.feature
"""

import json
import os
import random
from typing import Literal, Optional, cast

import litellm
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluationResultSkipped,
    EvaluatorEntry,
    LLMEvaluatorSettings,
    Money,
    SingleEvaluationResult,
)
from litellm import Choices, Message
from litellm.cost_calculator import completion_cost
from litellm.files.main import ModelResponse
from pydantic import BaseModel, Field


# Braces around placeholders are single-brace (str.format slots).
# Any literal braces in the template must be doubled. Tool-call schema
# below drives the response shape, so no JSON example is embedded.
DEFAULT_SELECT_BEST_PROMPT = """\
Pick the best of N candidate outputs against a known-good reference (golden answer).

Task:           {input}
Golden answer:  {golden}

Candidates:
{candidates}

Reason step-by-step about how closely each candidate matches the
golden answer in correctness, completeness, and style. Then pick
the best candidate by its slot label, or "tie" if no clear winner.
Prefer cheaper/faster only when quality is comparable.
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

    # Deterministic seed for candidate-order shuffling. When None, order
    # is left as-is (callers wanting reproducibility should always set it).
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


class SelectBestCompareEvaluator(
    BaseEvaluator[
        SelectBestCompareEntry, SelectBestCompareSettings, SelectBestCompareResult
    ]
):
    """
    Native N-way LLM-as-judge evaluator. Picks the best of 3+ candidate
    outputs against a golden reference in a single judge call, with
    deterministic candidate-order shuffling for position-bias mitigation.
    """

    name = "N-way Compare"
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
                Money(amount=verdict["cost"], currency="USD")
                if verdict["cost"]
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
        rendered_prompt = self.settings.prompt.format(
            input=entry.input or "",
            golden=entry.golden or "",
            candidates=candidates_block,
        )

        slot_labels = list(slot_to_candidate.keys())
        winner_enum = slot_labels + (["tie"] if self.settings.allow_tie else [])

        response = litellm.completion(
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
                                        "Step-by-step comparison of the "
                                        "candidates against the golden answer."
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
        else:
            winner_id = slot_to_candidate[displayed].id

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
