from typing import Literal
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
    EvaluatorSettings,
    EvaluationResultSkipped,
)
from ragas import SingleTurnSample
from .lib.common import (
    RagasResult,
    env_vars,
)
from pydantic import Field
from ragas.metrics import (
    NonLLMContextRecall,
    DistanceMeasure,
)


class RagasContextRecallEntry(EvaluatorEntry):
    contexts: list[str]
    expected_contexts: list[str]


class RagasContextRecallResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the Recall score.",
    )


class RagasContextRecallSettings(EvaluatorSettings):
    distance_measure: Literal["levenshtein", "hamming", "jaro", "jaro_winkler"] = (
        "levenshtein"
    )


class RagasContextRecallEvaluator(
    BaseEvaluator[
        RagasContextRecallEntry,
        RagasContextRecallSettings,
        RagasContextRecallResult,
    ]
):
    """
    Measures how many relevant contexts were retrieved compared to expected contexts, increasing it means more signal in the retrieval. Uses traditional string distance metrics.
    """

    name = "Context Recall"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasContextRecallSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/#non-llm-based-context-recall"
    is_guardrail = False

    def evaluate(self, entry: RagasContextRecallEntry) -> SingleEvaluationResult:
        if len(entry.expected_contexts) == 0 and len(entry.contexts) == 0:
            return RagasResult(
                score=1.0,
                cost=None,
                details="No contexts retrieved, but also no contexts expected, so that's a perfect recall of 1",
            )
        if len(entry.expected_contexts) == 0:
            return RagasResult(
                score=1.0,
                cost=None,
                details="No contexts expected, meaning nothing was missing, so that's a perfect recall of 1",
            )
        if len(entry.contexts) == 0:
            return RagasResult(
                score=0.0,
                cost=None,
                details="No contexts retrieved, recall is 0",
            )

        scorer = NonLLMContextRecall()
        scorer.distance_measure = {
            "levenshtein": DistanceMeasure.LEVENSHTEIN,
            "hamming": DistanceMeasure.HAMMING,
            "jaro": DistanceMeasure.JARO,
            "jaro_winkler": DistanceMeasure.JARO_WINKLER,
        }[self.settings.distance_measure]

        score = scorer.single_turn_score(
            SingleTurnSample(
                retrieved_contexts=entry.contexts,
                reference_contexts=entry.expected_contexts,
            )
        )

        return RagasResult(
            score=score,
            cost=None,
            details=None,
        )
