from typing import Optional
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
)
from .ragas_lib.common import env_vars, evaluate_ragas, RagasSettings
from pydantic import Field


class RagasAnswerCorrectnessEntry(EvaluatorEntry):
    input: Optional[str] = Field(default="")
    output: str
    expected_output: str


class RagasAnswerCorrectnessResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the correctness of the answer.",
    )


class RagasAnswerCorrectnessEvaluator(
    BaseEvaluator[
        RagasAnswerCorrectnessEntry, RagasSettings, RagasAnswerCorrectnessResult
    ]
):
    """
    Computes with an LLM a weighted combination of factual as well as semantic similarity between the generated answer and the expected output.
    """

    name = "Ragas Answer Correctness"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = (
        "https://docs.ragas.io/en/latest/concepts/metrics/answer_correctness.html"
    )
    is_guardrail = False

    def evaluate(self, entry: RagasAnswerCorrectnessEntry) -> SingleEvaluationResult:
        input = entry.input or ""
        return evaluate_ragas(
            evaluator=self,
            metric="answer_correctness",
            question=input,
            answer=entry.output,
            ground_truth=entry.expected_output,
            settings=self.settings,
        )
