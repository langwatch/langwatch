from typing import Literal, Optional
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


class CustomSimilarityEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None


class CustomSimilaritySettings(EvaluatorSettings):
    field: Literal["input", "output"] = "output"
    rule: Literal[
        "is_not_similar_to",
        "is_similar_to",
    ] = "is_not_similar_to"
    value: str = "example"
    threshold: float = 0.3
    embeddings_model: str = "openai/text-embedding-3-small"


class CustomSimilarityResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="How similar the input and output semantically, from 0.0 to 1.0, with 1.0 meaning the sentences are identical",
    )
    passed: Optional[bool] = Field(
        description="Passes if the cosine similarity crosses the threshold for the defined rule",
        default=None,
    )


class CustomSimilarityEvaluator(
    BaseEvaluator[
        CustomSimilarityEntry, CustomSimilaritySettings, CustomSimilarityResult
    ]
):
    """
    Allows you to check for semantic similarity or dissimilarity between input and output and a
    target value, so you can avoid sentences that you don't want to be present without having to
    match on the exact text.
    """

    name = "Semantic Similarity Evaluator"
    category = "custom"
    env_vars = []
    default_settings = CustomSimilaritySettings()
    is_guardrail = True

    def evaluate(self, entry: CustomSimilarityEntry) -> SingleEvaluationResult:
        target_value_embeddings = self.get_embeddings(self.settings.value)
        if isinstance(target_value_embeddings, EvaluationResultSkipped):
            return target_value_embeddings

        content = entry.input if self.settings.field == "input" else entry.output
        if not content:
            return EvaluationResultSkipped(details="No content to evaluate")
        entry_embeddings = self.get_embeddings(content)
        if isinstance(entry_embeddings, EvaluationResultSkipped):
            return entry_embeddings

        cosine_similarity = np.dot(target_value_embeddings, entry_embeddings) / (
            np.linalg.norm(target_value_embeddings) * np.linalg.norm(entry_embeddings)
        )

        details = (
            f'Cosine similarity of {cosine_similarity:.2f} between {self.settings.field} and "{self.settings.value}"'
            f' (threshold: {">" if self.settings.rule == "is_similar_to" else "<"} {self.settings.threshold})"'
        )

        if self.settings.rule == "is_similar_to":
            return CustomSimilarityResult(
                score=cosine_similarity,
                passed=cosine_similarity > self.settings.threshold,
                details=details,
            )
        else:
            return CustomSimilarityResult(
                score=cosine_similarity,
                passed=cosine_similarity < self.settings.threshold,
                details=details,
            )

    def get_embeddings(self, text: str):
        model = self.settings.embeddings_model

        total_tokens = len(litellm.encode(model=model, text=text))
        if total_tokens > DEFAULT_MAX_TOKENS:
            return EvaluationResultSkipped(
                details=f"Total tokens exceed the maximum of {DEFAULT_MAX_TOKENS} tokens: {total_tokens} tokens used"
            )

        response = litellm.embedding(model=model, input=text)
        return response.data[0]["embedding"]  # type: ignore
