from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
)
from .ragas_lib.common import env_vars, evaluate_ragas, RagasSettings
from pydantic import Field


class RagasAnswerRelevancyEntry(EvaluatorEntry):
    input: str
    output: str


class RagasAnswerRelevancyResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the relevance of the answer.",
    )


class RagasAnswerRelevancyEvaluator(
    BaseEvaluator[RagasAnswerRelevancyEntry, RagasSettings, RagasAnswerRelevancyResult]
):
    """
    Evaluates how pertinent the generated answer is to the given prompt. Higher scores indicate better relevancy.
    """

    name = "Ragas Answer Relevancy"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/latest/concepts/metrics/answer_relevance.html"
    is_guardrail = False

    def evaluate(self, entry: RagasAnswerRelevancyEntry) -> SingleEvaluationResult:
        return evaluate_ragas(
            evaluator=self,
            metric="answer_relevancy",
            question=entry.input,
            answer=entry.output,
            settings=self.settings,
        )
