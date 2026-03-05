from typing import Literal, Optional
from pydantic import BaseModel, Field
from openai import OpenAI

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
    BatchEvaluationResult,
    EvaluatorEntry,
    EvaluationResultSkipped,
)
from tqdm.auto import tqdm


class OpenAIModerationEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None


class OpenAIModerationCategories(BaseModel):
    harassment: bool = True
    harassment_threatening: bool = True
    hate: bool = True
    hate_threatening: bool = True
    self_harm: bool = True
    self_harm_instructions: bool = True
    self_harm_intent: bool = True
    sexual: bool = True
    sexual_minors: bool = True
    violence: bool = True
    violence_graphic: bool = True


class OpenAIModerationSettings(EvaluatorSettings):
    model: Literal["text-moderation-stable", "text-moderation-latest"] = Field(
        default="text-moderation-stable",
        description="The model version to use, `text-moderation-latest` will be automatically upgraded over time, while `text-moderation-stable` will only be updated with advanced notice by OpenAI.",
    )
    categories: OpenAIModerationCategories = Field(
        default=OpenAIModerationCategories(),
        description="The categories of content to check for moderation.",
    )


class OpenAIModerationResult(EvaluationResult):
    passed: Optional[bool] = Field(
        description="Fails if any moderation category is flagged",
        default=None,
    )
    score: float = Field(
        description="The model's confidence on primary category where the input violates the OpenAI's policy. The value is between 0 and 1, where higher values denote higher confidence."
    )


class OpenAIModerationEvaluator(
    BaseEvaluator[
        OpenAIModerationEntry, OpenAIModerationSettings, OpenAIModerationResult
    ]
):
    """
    This evaluator uses OpenAI's moderation API to detect potentially harmful content in text,
    including harassment, hate speech, self-harm, sexual content, and violence.
    """

    name = "OpenAI Moderation"
    category = "safety"
    env_vars = ["OPENAI_API_KEY"]
    default_settings = OpenAIModerationSettings()
    docs_url = "https://platform.openai.com/docs/guides/moderation/overview"
    is_guardrail = True

    def evaluate_batch(
        self, data: list[OpenAIModerationEntry], index=0
    ) -> BatchEvaluationResult:
        client = OpenAI(api_key=self.get_env("OPENAI_API_KEY"))

        results: list[SingleEvaluationResult] = []

        contents_input = [entry.input or "" for entry in data]
        contents_output = [entry.output or "" for entry in data]
        response_input = client.moderations.create(input=contents_input)
        response_output = client.moderations.create(input=contents_output)

        for i, (input_result, output_result) in enumerate(
            zip(response_input.results, response_output.results)
        ):

            if not contents_input[i] and not contents_output[i]:
                results.append(
                    EvaluationResultSkipped(details="Input and output are both empty")
                )
            continue

        # Combine results by taking the maximum scores for each category
        combined_category_scores = {
            category: max(
                input_result.category_scores.model_dump().get(category, 0),
                output_result.category_scores.model_dump().get(category, 0),
            )
            for category in self.settings.categories.model_dump().keys()
        }

        detected_categories = {
            category: score > 0.5  # You may want to adjust this threshold
            for category, score in combined_category_scores.items()
            if self.settings.categories.model_dump().get(category, False)
        }

        highest_categories = sorted(
            combined_category_scores.items(),
            key=lambda x: x[1],
            reverse=True,
        )
        score = (
            max(combined_category_scores.values()) if combined_category_scores else 0
        )

        passed = not any(detected_categories.values())

        details = (
            (
                "Detected "
                + ", ".join(
                    [
                        f"{category} ({score * 100:.2f}% confidence)"
                        for category, score in highest_categories
                        if detected_categories.get(category, False)
                    ]
                )
            )
            if not passed
            else None
        )

        results.append(
            OpenAIModerationResult(score=score, passed=passed, details=details)
        )

        return results
