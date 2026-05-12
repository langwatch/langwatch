from typing import Literal
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    EvaluatorSettings,
    SingleEvaluationResult,
)
from ragas import SingleTurnSample
from .lib.common import (
    RagasResult,
    env_vars,
)
from pydantic import Field
from ragas.metrics import RougeScore


class RagasROUGEScoreEntry(EvaluatorEntry):
    output: str
    expected_output: str


class RagasROUGEScoreResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="ROUGE similarity score",
    )


class RagasROUGEScoreSettings(EvaluatorSettings):
    rouge_type: Literal["rouge1", "rougeL"] = Field(
        default="rouge1",
        description="ROUGE type",
    )
    measure_type: Literal["fmeasure", "precision", "recall"] = Field(
        default="fmeasure",
        description="ROUGE measure type",
    )


class RagasROUGEScoreEvaluator(
    BaseEvaluator[
        RagasROUGEScoreEntry,
        RagasROUGEScoreSettings,
        RagasROUGEScoreResult,
    ]
):
    """
    Traditional NLP metric. ROUGE score for evaluating the similarity between two strings.
    """

    name = "ROUGE Score"
    category = "quality"
    env_vars = env_vars
    default_settings = RagasROUGEScoreSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/traditional/#rouge-score"
    is_guardrail = False

    def evaluate(self, entry: RagasROUGEScoreEntry) -> SingleEvaluationResult:
        scorer = RougeScore(
            rouge_type=self.settings.rouge_type,
            measure_type=self.settings.measure_type,
        )

        score = scorer.single_turn_score(
            SingleTurnSample(
                response=entry.output,
                reference=entry.expected_output,
            )
        )

        return RagasResult(
            score=score,
            cost=None,
            details=None,
        )
