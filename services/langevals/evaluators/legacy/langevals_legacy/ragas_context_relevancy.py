from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
)
from .ragas_lib.common import env_vars, evaluate_ragas, RagasSettings
from pydantic import Field


class RagasContextRelevancyEntry(EvaluatorEntry):
    output: str
    contexts: list[str]


class RagasContextRelevancyResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the relevancy of the context.",
    )


class RagasContextRelevancyEvaluator(
    BaseEvaluator[
        RagasContextRelevancyEntry, RagasSettings, RagasContextRelevancyResult
    ]
):
    """
    This metric gauges the relevancy of the retrieved context, calculated based on both the question and contexts. The values fall within the range of (0, 1), with higher values indicating better relevancy.
    """

    name = "Ragas Context Relevancy"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/latest/concepts/metrics/context_relevancy.html"
    is_guardrail = False

    def evaluate(self, entry: RagasContextRelevancyEntry) -> SingleEvaluationResult:
        return evaluate_ragas(
            evaluator=self,
            metric="context_relevancy",
            answer=entry.output,
            contexts=entry.contexts,
            settings=self.settings,
        )
