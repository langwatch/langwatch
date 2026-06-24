"""
Pairwise Compare: native LLM-as-judge pairwise evaluator.

Given two candidate outputs (from two different EvaluationsV3 target
columns) and a golden reference, asks an LLM judge to pick the
better candidate. Defaults to swap-and-confirm position-bias
mitigation (two judge calls per row with positions swapped; tie
on disagreement).

Issue:        https://github.com/langwatch/langwatch/issues/5100
Parent epic:  https://github.com/langwatch/langwatch/issues/5099
BDD spec:     specs/experiments/pairwise-compare-mvp.feature
"""

import json
import os
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
from pydantic import Field


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


class PairwiseCompareEntry(EvaluatorEntry, allow_extra=True):
    input: Optional[str] = None
    golden: Optional[str] = None
    candidate_a_id: str
    candidate_a_output: str
    candidate_a_cost: Optional[float] = None
    candidate_a_duration: Optional[float] = None
    candidate_b_id: str
    candidate_b_output: str
    candidate_b_cost: Optional[float] = None
    candidate_b_duration: Optional[float] = None


class PairwiseCompareSettings(LLMEvaluatorSettings):
    prompt: str = Field(
        default=DEFAULT_PAIRWISE_PROMPT,
        description="Judge prompt template (golden-aware by default)",
    )
    swap_and_confirm: bool = Field(
        default=True,
        description=(
            "Run two judge calls with A/B positions swapped; tie on "
            "disagreement. Doubles judge cost but materially reduces "
            "position bias (PandaLM: 68% -> 51%)."
        ),
    )
    allow_tie: bool = Field(
        default=True,
        description="Allow the judge to return 'tie' when candidates are equivalent",
    )
    include_metrics: list[Literal["cost", "duration"]] = Field(
        default_factory=list,
        description="Per-candidate metrics to inject into the judge prompt",
    )


class PairwiseCompareResult(EvaluationResult):
    score: float = Field(default=0.5, description="0=A wins, 1=B wins, 0.5=tie")
    label: Optional[Literal["A", "B", "tie"]] = Field(
        default=None,
        description="Which candidate won, or tie",
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
    Native pairwise LLM-as-judge evaluator. Compare two candidate
    outputs against a golden reference, with optional swap-and-confirm
    position-bias mitigation.
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

        if not entry.candidate_a_output or not entry.candidate_b_output:
            return EvaluationResultSkipped(
                details="Missing candidate output(s)"
            )

        first = self._judge(entry, ("A", "B"))

        if not self.settings.swap_and_confirm:
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
