from typing import Optional
from langevals_core.base_evaluator import (
    DEFAULT_MAX_TOKENS,
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
)
from pydantic import Field
import litellm
import numpy as np

class SentimentEntry(EvaluatorEntry):
    input: str


class SentimentSettings(EvaluatorSettings):
    embeddings_model: str = Field(
        default="openai/text-embedding-3-small",
        description="The embeddings model to use for sentiment analysis",
    )
    positive_reference: str = Field(
        default="Comment of a very happy and satisfied user",
        description="Reference phrase representing the positive end of the sentiment scale",
    )
    negative_reference: str = Field(
        default="Comment of a user who is extremely dissatisfied",
        description="Reference phrase representing the negative end of the sentiment scale",
    )
    normalization_factor: float = Field(
        default=0.10,
        description="Controls sentiment sensitivity. Decrease to make scores more extreme (fewer neutrals), increase to make scores more moderate (more neutrals)",
    )


class SentimentResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="Sentiment score from -1.0 (very negative) to 1.0 (very positive)",
    )
    label: Optional[str] = Field(
        default=None,
        description="Sentiment label: 'positive' or 'negative'",
    )


class SentimentEvaluator(
    BaseEvaluator[SentimentEntry, SentimentSettings, SentimentResult]
):
    """
    Analyzes the sentiment of the input text by comparing its embedding similarity
    to positive and negative reference phrases. Returns a score from -1.0 (very negative)
    to 1.0 (very positive) and a corresponding label.
    """

    name = "Sentiment Evaluator"
    category = "quality"
    env_vars = []
    default_settings = SentimentSettings()
    is_guardrail = False

    def evaluate(self, entry: SentimentEntry) -> SingleEvaluationResult:
        if not entry.input:
            return EvaluationResultSkipped(details="No input text to evaluate")

        model = self.settings.embeddings_model

        total_tokens = len(litellm.encode(model=model, text=entry.input))
        if total_tokens > DEFAULT_MAX_TOKENS:
            return EvaluationResultSkipped(
                details=f"Total tokens exceed the maximum of {DEFAULT_MAX_TOKENS} tokens: {total_tokens} tokens used"
            )

        input_embedding = self._get_embedding(entry.input)
        negative_embedding = self._get_embedding(self.settings.negative_reference)
        positive_embedding = self._get_embedding(self.settings.positive_reference)

        positive_similarity = self._cosine_similarity(input_embedding, positive_embedding)
        negative_similarity = self._cosine_similarity(input_embedding, negative_embedding)

        raw_score = positive_similarity - negative_similarity
        normalized_score = max(-1.0, min(1.0, raw_score / self.settings.normalization_factor))
        label = "negative" if raw_score < 0 else "positive"

        return SentimentResult(
            score=normalized_score,
            label=label,
            details=f"Sentiment: {label} (score: {normalized_score:.2f})",
        )

    def _get_embedding(self, text: str) -> list[float]:
        response = litellm.embedding(model=self.settings.embeddings_model, input=text)
        return response.data[0]["embedding"]

    def _cosine_similarity(self, vec_a: list[float], vec_b: list[float]) -> float:
        a = np.array(vec_a)
        b = np.array(vec_b)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
