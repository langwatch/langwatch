"""
Pairwise Compare: native LLM-as-judge comparison evaluator.

Two modes:

  - "pairwise"   (default)  — exactly 2 candidates + golden, swap-and-confirm
                              position-bias mitigation (2 judge calls/row).
                              The MVP from #5100.

  - "select_best"           — N candidates + golden, one judge call/row with
                              candidate order shuffled deterministically by
                              `row_index` for position-bias mitigation.
                              Added in #5101.

The two modes share the same evaluator id (`langevals/pairwise_compare`)
so existing wiring (orchestrator Phase 2, EvaluatorConfig.pairwise, the
TS catalog entry) extends cleanly instead of forking.

Issue:        https://github.com/langwatch/langwatch/issues/5101
Parent epic:  https://github.com/langwatch/langwatch/issues/5099
BDD spec:     specs/experiments/pairwise-nway-select-best.feature
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
DEFAULT_PAIRWISE_PROMPT = """\
Compare two candidate outputs against a known-good reference (golden answer).

Task:           {input}
Golden answer:  {golden}

Candidate A:    {candidate_a_output}
Candidate B:    {candidate_b_output}

Reason step-by-step about how closely each candidate matches the
golden answer in correctness, completeness, and style. Then pick
the better candidate, or "tie" if equivalent.
Prefer cheaper/faster only when quality is comparable.
"""


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
    """One candidate output, used by select_best (N-way) mode."""

    id: str
    output: str
    cost: Optional[float] = None
    duration: Optional[float] = None


class PairwiseCompareEntry(EvaluatorEntry, allow_extra=True):
    input: Optional[str] = None
    golden: Optional[str] = None

    # Legacy 2-way fields — populated by the orchestrator in pairwise mode.
    candidate_a_id: Optional[str] = None
    candidate_a_output: Optional[str] = None
    candidate_a_cost: Optional[float] = None
    candidate_a_duration: Optional[float] = None
    candidate_b_id: Optional[str] = None
    candidate_b_output: Optional[str] = None
    candidate_b_cost: Optional[float] = None
    candidate_b_duration: Optional[float] = None

    # Generalized N-way field — populated by the orchestrator in
    # select_best mode. Falls back to building from candidate_a_* /
    # candidate_b_* for callers that only set the legacy fields.
    candidates: Optional[list[CandidateInput]] = None

    # Deterministic seed for randomize_order in select_best mode.
    # When None, order is left as-is (callers wanting reproducibility
    # should always set it).
    row_index: Optional[int] = None


class PairwiseCompareSettings(LLMEvaluatorSettings):
    mode: Literal["pairwise", "select_best"] = Field(
        default="pairwise",
        description=(
            "Comparison mode. 'pairwise' compares exactly 2 candidates "
            "with swap-and-confirm position-bias mitigation (2 judge calls "
            "per row). 'select_best' picks the best of N candidates in a "
            "single judge call with candidate order shuffled deterministically "
            "by row_index."
        ),
    )
    prompt: str = Field(
        default=DEFAULT_PAIRWISE_PROMPT,
        description=(
            "Judge prompt template for pairwise mode. Placeholders: "
            "{input}, {golden}, {candidate_a_output}, {candidate_b_output}."
        ),
    )
    select_best_prompt: str = Field(
        default=DEFAULT_SELECT_BEST_PROMPT,
        description=(
            "Judge prompt template for select_best (N-way) mode. "
            "Placeholders: {input}, {golden}, {candidates} (a pre-rendered "
            "bulleted list with slot labels and optional per-candidate metrics)."
        ),
    )
    swap_and_confirm: bool = Field(
        default=True,
        description=(
            "[Deprecated — use position_bias_mitigation.] When "
            "position_bias_mitigation is unset, this boolean still controls "
            "pairwise mode: True -> swap_and_confirm, False -> none. "
            "Ignored in select_best mode."
        ),
    )
    position_bias_mitigation: Optional[
        Literal["swap_and_confirm", "randomize_order", "none"]
    ] = Field(
        default=None,
        description=(
            "How to mitigate position bias. When unset, defaults to "
            "'swap_and_confirm' in pairwise mode (or 'none' if "
            "swap_and_confirm is False) and 'randomize_order' in select_best "
            "mode. 'swap_and_confirm' is only meaningful for 2 candidates; "
            "in select_best mode it falls back to 'randomize_order'."
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


class PairwiseCompareResult(EvaluationResult):
    score: float = Field(
        default=0.5,
        description=(
            "Pairwise mode: 0=A wins, 1=B wins, 0.5=tie. "
            "Select_best mode: 1.0 when a winner was picked, 0.5 for tie."
        ),
    )
    label: Optional[str] = Field(
        default=None,
        description=(
            "Pairwise mode: 'A' | 'B' | 'tie'. "
            "Select_best mode: the winning candidate id (matches the id "
            "supplied in entry.candidates) or 'tie'."
        ),
    )
    details: Optional[str] = Field(
        default=None,
        description="Judge reasoning text",
    )


class PairwiseCompareEvaluator(
    BaseEvaluator[
        PairwiseCompareEntry, PairwiseCompareSettings, PairwiseCompareResult
    ]
):
    """
    Native pairwise / N-way LLM-as-judge evaluator. Compares candidate
    outputs against a golden reference. Two modes:

      pairwise    — exactly 2 candidates, swap-and-confirm by default
      select_best — N candidates, randomize_order by default
    """

    name = "Pairwise Compare"
    category = "quality"
    env_vars = []
    default_settings = PairwiseCompareSettings()
    is_guardrail = False

    def evaluate(self, entry: PairwiseCompareEntry) -> SingleEvaluationResult:
        os.environ["AZURE_API_VERSION"] = "2023-12-01-preview"
        if self.env:
            for key, env in self.env.items():
                os.environ[key] = env

        if self.settings.mode == "select_best":
            return self._evaluate_select_best(entry)
        return self._evaluate_pairwise(entry)

    # ------------------------------------------------------------------
    # Pairwise (2-way) — MVP path from #5100, unchanged behavior.
    # ------------------------------------------------------------------

    def _evaluate_pairwise(
        self, entry: PairwiseCompareEntry
    ) -> SingleEvaluationResult:
        if not entry.candidate_a_output or not entry.candidate_b_output:
            return EvaluationResultSkipped(
                details="Missing candidate output(s)"
            )

        mitigation = self._resolve_pairwise_mitigation()

        first = self._judge(entry, ("A", "B"))

        if mitigation != "swap_and_confirm":
            winner = first["winner"]
            reasoning = first["reasoning"]
            total_cost = first["cost"] or 0.0
        else:
            second = self._judge(entry, ("B", "A"))
            if first["winner"] == second["winner"]:
                winner = first["winner"]
            else:
                winner = "tie"
            reasoning = (
                f"Call 1 (A in slot A, B in slot B): {first['reasoning']}\n\n"
                f"Call 2 (B in slot A, A in slot B): {second['reasoning']}"
            )
            total_cost = (first["cost"] or 0.0) + (second["cost"] or 0.0)

        score_map = {"A": 0.0, "tie": 0.5, "B": 1.0}

        return PairwiseCompareResult(
            score=score_map[winner],
            label=cast(Literal["A", "B", "tie"], winner),
            details=reasoning,
            cost=Money(amount=total_cost, currency="USD") if total_cost else None,
        )

    def _resolve_pairwise_mitigation(
        self,
    ) -> Literal["swap_and_confirm", "randomize_order", "none"]:
        """
        Resolve effective bias mitigation for pairwise mode. Honors the
        new `position_bias_mitigation` field when set, falling back to
        the deprecated `swap_and_confirm` boolean for backward compat.
        """
        if self.settings.position_bias_mitigation is not None:
            return self.settings.position_bias_mitigation
        return "swap_and_confirm" if self.settings.swap_and_confirm else "none"

    def _judge(
        self,
        entry: PairwiseCompareEntry,
        order: tuple[Literal["A", "B"], Literal["A", "B"]],
    ) -> dict:
        """
        Run one judge call. `order` describes which original candidate
        fills each prompt slot: ("A","B") = unswapped, ("B","A") = swapped.

        Returns {"winner": "A"|"B"|"tie", "reasoning": str, "cost": float|None}
        where "winner" is translated back to the ORIGINAL candidate label
        (not the slot the judge picked).
        """

        def pick(slot: Literal["A", "B"], attr: str):
            actual = order[0] if slot == "A" else order[1]
            return getattr(entry, f"candidate_{actual.lower()}_{attr}")

        rendered_prompt = self.settings.prompt.format(
            input=entry.input or "",
            golden=entry.golden or "",
            candidate_a_output=pick("A", "output"),
            candidate_b_output=pick("B", "output"),
        )

        if self.settings.include_metrics:
            metrics_lines = ["", "Per-candidate metrics:"]
            for slot in ("A", "B"):
                parts = [f"  Candidate {slot}:"]
                if "cost" in self.settings.include_metrics:
                    c = pick(slot, "cost")
                    if c is not None:
                        parts.append(f"cost=${c:.6f}")
                if "duration" in self.settings.include_metrics:
                    d = pick(slot, "duration")
                    if d is not None:
                        parts.append(f"duration={d:.3f}s")
                if len(parts) > 1:
                    metrics_lines.append(" ".join(parts))
            if len(metrics_lines) > 2:
                rendered_prompt += "\n" + "\n".join(metrics_lines)

        winner_enum = ["A", "B", "tie"] if self.settings.allow_tie else ["A", "B"]

        response = litellm.completion(
            model=self.settings.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an impartial judge comparing two candidate "
                        "outputs. Reason briefly, then pick the winner using "
                        "the provided function call."
                    ),
                },
                {"role": "user", "content": rendered_prompt},
            ],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "pairwise_verdict",
                        "description": (
                            "Record the pairwise verdict. Reason first, "
                            "then pick the winner."
                        ),
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "reasoning": {
                                    "type": "string",
                                    "description": (
                                        "Step-by-step comparison of the two "
                                        "candidates against the golden answer."
                                    ),
                                },
                                "winner": {
                                    "type": "string",
                                    "enum": winner_enum,
                                    "description": (
                                        "Which candidate wins, by slot label. "
                                        "Use 'tie' only when truly equivalent."
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
                "function": {"name": "pairwise_verdict"},
            },  # type: ignore
        )

        response = cast(ModelResponse, response)
        choice = cast(Choices, response.choices[0])
        arguments = json.loads(
            cast(Message, choice.message).tool_calls[0].function.arguments  # type: ignore
        )

        displayed = arguments["winner"]
        if displayed == "tie":
            actual_winner: Literal["A", "B", "tie"] = "tie"
        elif displayed == "A":
            actual_winner = order[0]
        else:
            actual_winner = order[1]

        try:
            call_cost = completion_cost(completion_response=response)
        except Exception:
            call_cost = None

        return {
            "winner": actual_winner,
            "reasoning": arguments["reasoning"],
            "cost": call_cost,
        }

    # ------------------------------------------------------------------
    # Select_best (N-way) — #5101 path.
    # ------------------------------------------------------------------

    def _evaluate_select_best(
        self, entry: PairwiseCompareEntry
    ) -> SingleEvaluationResult:
        candidates = self._collect_candidates(entry)

        # Drop candidates with empty/missing outputs — keep the rest if
        # the remainder is still ≥2.
        candidates = [c for c in candidates if c.output]

        if len(candidates) < 2:
            return EvaluationResultSkipped(
                details=(
                    f"select_best needs at least 2 candidates with non-empty "
                    f"outputs (got {len(candidates)})"
                )
            )

        mitigation = self._resolve_select_best_mitigation()

        if mitigation == "randomize_order":
            seed = entry.row_index if entry.row_index is not None else 0
            ordered = list(candidates)
            random.Random(seed).shuffle(ordered)
        else:
            ordered = list(candidates)

        verdict = self._judge_select_best(entry, ordered)

        winner_id = verdict["winner"]
        score = 0.5 if winner_id == "tie" else 1.0

        return PairwiseCompareResult(
            score=score,
            label=winner_id,
            details=verdict["reasoning"],
            cost=(
                Money(amount=verdict["cost"], currency="USD")
                if verdict["cost"]
                else None
            ),
        )

    def _collect_candidates(
        self, entry: PairwiseCompareEntry
    ) -> list[CandidateInput]:
        """
        Build the list of candidates for select_best. Prefers
        entry.candidates when set; falls back to assembling from the
        legacy candidate_a_* / candidate_b_* fields so callers that only
        know the 2-way shape can still opt into select_best mode.
        """
        if entry.candidates:
            return list(entry.candidates)

        fallback: list[CandidateInput] = []
        if entry.candidate_a_id and entry.candidate_a_output is not None:
            fallback.append(
                CandidateInput(
                    id=entry.candidate_a_id,
                    output=entry.candidate_a_output,
                    cost=entry.candidate_a_cost,
                    duration=entry.candidate_a_duration,
                )
            )
        if entry.candidate_b_id and entry.candidate_b_output is not None:
            fallback.append(
                CandidateInput(
                    id=entry.candidate_b_id,
                    output=entry.candidate_b_output,
                    cost=entry.candidate_b_cost,
                    duration=entry.candidate_b_duration,
                )
            )
        return fallback

    def _resolve_select_best_mitigation(
        self,
    ) -> Literal["randomize_order", "none"]:
        """
        Resolve effective bias mitigation for select_best mode.
        'swap_and_confirm' is not meaningful for N>2 — collapse to
        'randomize_order' rather than silently dropping bias correction.
        """
        explicit = self.settings.position_bias_mitigation
        if explicit == "none":
            return "none"
        return "randomize_order"

    def _judge_select_best(
        self,
        entry: PairwiseCompareEntry,
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
        rendered_prompt = self.settings.select_best_prompt.format(
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
                            "Record the select_best verdict. Reason first, "
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
        the select_best prompt, with optional cost/latency metrics.
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
