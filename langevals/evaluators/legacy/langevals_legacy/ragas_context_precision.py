from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
)
from .ragas_lib.common import env_vars, evaluate_ragas, RagasSettings
from pydantic import Field


class RagasContextPrecisionEntry(EvaluatorEntry):
    input: str
    contexts: list[str]
    expected_output: str


class RagasContextPrecisionResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the precision of the context."
    )


class RagasContextPrecisionEvaluator(
    BaseEvaluator[
        RagasContextPrecisionEntry, RagasSettings, RagasContextPrecisionResult
    ]
):
    """
    This metric evaluates whether all of the ground-truth relevant items present in the contexts are ranked higher or not. Higher scores indicate better precision.
    """

    name = "Ragas Context Precision"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/latest/concepts/metrics/context_precision.html"
    is_guardrail = False

    def evaluate(self, entry: RagasContextPrecisionEntry) -> SingleEvaluationResult:
        return evaluate_ragas(
            evaluator=self,
            metric="context_precision",
            question=entry.input,
            contexts=entry.contexts,
            ground_truth=entry.expected_output,
            settings=self.settings,
        )
