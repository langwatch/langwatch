from typing import Literal
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
    EvaluatorSettings,
)
from ragas import SingleTurnSample
from .lib.common import (
    RagasResult,
    env_vars,
    RagasSettings,
)
from pydantic import Field
from ragas.metrics import (
    NonLLMContextRecall,
    NonLLMContextPrecisionWithReference,
    NonLLMStringSimilarity,
    DistanceMeasure,
)


class RagasContextF1Entry(EvaluatorEntry):
    contexts: list[str]
    expected_contexts: list[str]


class RagasContextF1Result(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the F1 score.",
    )


class RagasContextF1Settings(EvaluatorSettings):
    distance_measure: Literal["levenshtein", "hamming", "jaro", "jaro_winkler"] = (
        "levenshtein"
    )


class RagasContextF1Evaluator(
    BaseEvaluator[
        RagasContextF1Entry,
        RagasContextF1Settings,
        RagasContextF1Result,
    ]
):
    """
    Balances between precision and recall for context retrieval, increasing it means a better signal-to-noise ratio. Uses traditional string distance metrics.
    """

    name = "Context F1"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasContextF1Settings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_F1/#non-llm-based-context-F1"
    is_guardrail = False

    def evaluate(self, entry: RagasContextF1Entry) -> SingleEvaluationResult:
        precision_scorer = NonLLMContextPrecisionWithReference(
            distance_measure=NonLLMStringSimilarity(
                distance_measure={
                    "levenshtein": DistanceMeasure.LEVENSHTEIN,
                    "hamming": DistanceMeasure.HAMMING,
                    "jaro": DistanceMeasure.JARO,
                    "jaro_winkler": DistanceMeasure.JARO_WINKLER,
                }[self.settings.distance_measure]
            )
        )

        if len(entry.expected_contexts) == 0 and len(entry.contexts) == 0:
            precision_score = 1.0
        elif len(entry.expected_contexts) == 0 or len(entry.contexts) == 0:
            precision_score = 0.0
        else:
            precision_score = precision_scorer.single_turn_score(
                SingleTurnSample(
                    retrieved_contexts=entry.contexts,
                    reference_contexts=entry.expected_contexts,
                )
            )

        if len(entry.expected_contexts) == 0 and len(entry.contexts) == 0:
            recall_score = 1.0
        elif len(entry.expected_contexts) == 0:
            recall_score = 1.0
        elif len(entry.contexts) == 0:
            recall_score = 0.0
        else:
            recall_scorer = NonLLMContextRecall()
            recall_scorer.distance_measure = {
                "levenshtein": DistanceMeasure.LEVENSHTEIN,
                "hamming": DistanceMeasure.HAMMING,
                "jaro": DistanceMeasure.JARO,
                "jaro_winkler": DistanceMeasure.JARO_WINKLER,
            }[self.settings.distance_measure]

            recall_score = recall_scorer.single_turn_score(
                SingleTurnSample(
                    retrieved_contexts=entry.contexts,
                    reference_contexts=entry.expected_contexts,
                )
            )

        f1_score = (
            2 * (precision_score * recall_score) / (precision_score + recall_score)
            if (precision_score + recall_score) != 0
            else 0
        )

        return RagasResult(
            score=f1_score,
            cost=None,
            details=f"Precision: {precision_score}, Recall: {recall_score}",
        )
