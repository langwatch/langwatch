from typing import Literal
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
    EvaluationResultSkipped,
)
from ragas import SingleTurnSample
from .lib.common import (
    RagasResult,
    capture_cost,
    check_max_tokens,
    env_vars,
    RagasSettings,
    prepare_llm,
)
from pydantic import Field
from ragas.metrics import FactualCorrectness


class RagasFactualCorrectnessEntry(EvaluatorEntry):
    output: str
    expected_output: str


class RagasFactualCorrectnessResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating how factually similar the generated answer is to the expected output.",
    )


class RagasFactualCorrectnessSettings(RagasSettings):
    mode: Literal["f1", "precision", "recall"] = Field(
        default="f1",
        description="The mode to use for the factual correctness metric.",
    )
    atomicity: Literal["low", "high"] = Field(
        default="low",
        description="The level of atomicity for claim decomposition.",
    )
    coverage: Literal["low", "high"] = Field(
        default="low",
        description="The level of coverage for claim decomposition.",
    )


class RagasFactualCorrectnessEvaluator(
    BaseEvaluator[
        RagasFactualCorrectnessEntry,
        RagasFactualCorrectnessSettings,
        RagasFactualCorrectnessResult,
    ]
):
    """
    Computes with an LLM how factually similar the generated answer is to the expected output.
    """

    name = "LLM Factual Match"
    category = "quality"
    env_vars = env_vars
    default_settings = RagasFactualCorrectnessSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/factual_correctness/"
    is_guardrail = False

    def evaluate(self, entry: RagasFactualCorrectnessEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            output=entry.output,
            expected_output=entry.expected_output,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = FactualCorrectness(
            llm=llm,
            mode=self.settings.mode,
            atomicity=self.settings.atomicity,
            coverage=self.settings.coverage,
        )

        _original_verify_claims = scorer.verify_claims

        breakdowns = []

        async def verify_claims(premise: str, hypothesis_list: list[str], callbacks):
            nonlocal breakdowns
            scores = await _original_verify_claims(premise, hypothesis_list, callbacks)
            breakdowns.append(
                {
                    "premise": premise,
                    "hypothesis_list": hypothesis_list,
                    "scores": scores,
                }
            )
            return scores

        scorer.verify_claims = verify_claims

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    response=entry.output,
                    reference=entry.expected_output,
                )
            )

        if len(breakdowns) == 0:
            return EvaluationResultSkipped(
                details="No claims could be generated from output.",
            )

        details = ""
        if len(breakdowns) > 0:
            breakdown = breakdowns[0]
            details += (
                f"# Precision\nPremise: {breakdown['premise']}\nHypothesis list:\n"
            )
            for i, score_ in enumerate(breakdown["scores"]):
                details += f"- \"{breakdown['hypothesis_list'][i]}\": {score_}\n"

        if len(breakdowns) > 1:
            breakdown = breakdowns[1]
            details += (
                f"\n# Recall\nPremise: {breakdown['premise']}\nHypothesis list:\n"
            )
            for i, score_ in enumerate(breakdown["scores"]):
                details += f"- \"{breakdown['hypothesis_list'][i]}\": {score_}\n"

        return RagasResult(
            score=score,
            cost=cost,
            details=details if details else None,
        )
