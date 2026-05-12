from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
)
from .ragas_lib.common import env_vars, evaluate_ragas, RagasSettings
from pydantic import Field


class RagasContextUtilizationEntry(EvaluatorEntry):
    input: str
    output: str
    contexts: list[str]


class RagasContextUtilizationResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the utilization of the context.",
    )


class RagasContextUtilizationEvaluator(
    BaseEvaluator[
        RagasContextUtilizationEntry, RagasSettings, RagasContextUtilizationResult
    ]
):
    """
    This metric evaluates whether all of the output relevant items present in the contexts are ranked higher or not. Higher scores indicate better utilization.
    """

    name = "Ragas Context Utilization"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/latest/concepts/metrics/context_precision.html"
    is_guardrail = False

    def evaluate(self, entry: RagasContextUtilizationEntry) -> SingleEvaluationResult:
        return evaluate_ragas(
            evaluator=self,
            metric="context_utilization",
            question=entry.input,
            answer=entry.output,
            contexts=entry.contexts,
            settings=self.settings,
        )
