from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
)
from .ragas_lib.common import env_vars, evaluate_ragas, RagasSettings
from pydantic import Field


class RagasContextRecallEntry(EvaluatorEntry):
    input: str
    contexts: list[str]
    expected_output: str


class RagasContextRecallResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the recall of the context.",
    )


class RagasContextRecallEvaluator(
    BaseEvaluator[RagasContextRecallEntry, RagasSettings, RagasContextRecallResult]
):
    """
    This evaluator measures the extent to which the retrieved context aligns with the annotated answer, treated as the ground truth. Higher values indicate better performance.
    """

    name = "Ragas Context Recall"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/latest/concepts/metrics/context_recall.html"
    is_guardrail = False

    def evaluate(self, entry: RagasContextRecallEntry) -> SingleEvaluationResult:
        input = entry.input or ""
        return evaluate_ragas(
            evaluator=self,
            metric="context_recall",
            question=input,
            contexts=entry.contexts,
            ground_truth=entry.expected_output,
            settings=self.settings,
        )
