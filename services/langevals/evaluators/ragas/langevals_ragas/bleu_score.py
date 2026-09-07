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
from ragas.metrics import BleuScore


class RagasBLEUScoreEntry(EvaluatorEntry):
    output: str
    expected_output: str


class RagasBLEUScoreResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="BLEU similarity score",
    )


class RagasBLEUScoreEvaluator(
    BaseEvaluator[
        RagasBLEUScoreEntry,
        EvaluatorSettings,
        RagasBLEUScoreResult,
    ]
):
    """
    Traditional NLP metric. BLEU score for evaluating the similarity between two strings.
    """

    name = "BLEU Score"
    category = "quality"
    env_vars = env_vars
    default_settings = EvaluatorSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/traditional/#bleu-score"
    is_guardrail = False

    def evaluate(self, entry: RagasBLEUScoreEntry) -> SingleEvaluationResult:
        scorer = BleuScore()

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
