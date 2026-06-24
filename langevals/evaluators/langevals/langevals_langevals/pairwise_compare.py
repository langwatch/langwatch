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

SKELETON: this is the first commit. The full `evaluate()` body
lands in follow-up commits per the implementation steps in the
issue. Catalog generation is intentionally not yet wired.
"""

from typing import Literal, Optional

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluationResultSkipped,
    EvaluatorEntry,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
)
from pydantic import Field


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

Respond as JSON: { "reasoning": "...", "winner": "A" | "B" | "tie" }
"""


class PairwiseCompareEntry(EvaluatorEntry):
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

    Implementation plan (issue #5100):

      1. Render prompt template (with optional per-candidate metrics).
      2. Call litellm.completion (tool-call shape — see llm_boolean.py).
      3. Parse JSON args -> {reasoning, winner}.
      4. If swap_and_confirm: repeat with A/B swapped; agree-or-tie.
      5. Return PairwiseCompareResult with score/label/details/cost.
    """

    name = "Pairwise Compare"
    category = "quality"
    env_vars: list[str] = []
    default_settings = PairwiseCompareSettings()
    is_guardrail = False

    def evaluate(self, entry: PairwiseCompareEntry) -> SingleEvaluationResult:
        return EvaluationResultSkipped(
            details="Pairwise compare implementation pending — see #5100"
        )
