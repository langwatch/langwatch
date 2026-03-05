from typing import Literal, Optional
from azure.ai.contentsafety import ContentSafetyClient
from azure.core.credentials import AzureKeyCredential
from azure.ai.contentsafety.models import AnalyzeTextOptions

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
    EvaluatorEntry,
    EvaluationResultSkipped,
)
from pydantic import BaseModel, Field


class AzureContentSafetyEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None


class AzureContentSafetyCategories(BaseModel):
    Hate: bool = True
    SelfHarm: bool = True
    Sexual: bool = True
    Violence: bool = True


class AzureContentSafetySettings(EvaluatorSettings):
    severity_threshold: Literal[1, 2, 3, 4, 5, 6, 7] = Field(
        default=1,
        description="The minimum severity level to consider content as unsafe, from 1 to 7.",
    )
    categories: AzureContentSafetyCategories = Field(
        default=AzureContentSafetyCategories(),
        description="The categories of moderation to check for.",
    )
    output_type: Literal["FourSeverityLevels", "EightSeverityLevels"] = Field(
        default="FourSeverityLevels",
        description="The type of severity levels to return on the full 0-7 severity scale, it can be either the trimmed version with four values (0, 2, 4, 6 scores) or the whole range.",
    )


class AzureContentSafetyResult(EvaluationResult):
    score: float = Field(
        description="The severity level of the detected content from 0 to 7. A higher score indicates higher severity."
    )


class AzureContentSafetyEvaluator(
    BaseEvaluator[
        AzureContentSafetyEntry,
        AzureContentSafetySettings,
        AzureContentSafetyResult,
    ]
):
    """
    This evaluator detects potentially unsafe content in text, including hate speech,
    self-harm, sexual content, and violence. It allows customization of the severity
    threshold and the specific categories to check.
    """

    name = "Azure Content Safety"
    category = "safety"
    env_vars = ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"]
    default_settings = AzureContentSafetySettings()
    docs_url = "https://learn.microsoft.com/en-us/azure/ai-services/content-safety/quickstart-text"
    is_guardrail = True

    def evaluate(self, entry: AzureContentSafetyEntry) -> SingleEvaluationResult:
        endpoint = self.get_env("AZURE_CONTENT_SAFETY_ENDPOINT")
        key = self.get_env("AZURE_CONTENT_SAFETY_KEY")

        client = ContentSafetyClient(endpoint, AzureKeyCredential(key))

        content = "\n\n".join([entry.input or "", entry.output or ""]).strip()
        if not content:
            return EvaluationResultSkipped(details="Input and output are both empty")
        request = AnalyzeTextOptions(
            text=content[0:10000],
            categories=[
                key
                for key in self.settings.categories.model_dump().keys()
                if self.settings.categories.model_dump().get(key, False)
            ],
            output_type=self.settings.output_type,
        )
        response = client.analyze_text(request)

        categories_analysis = {
            item.category: item.severity for item in response.categories_analysis
        }
        score = max(categories_analysis.values(), default=0)  # type: ignore
        passed = score < self.settings.severity_threshold

        details = (
            ", ".join(
                f"{category} (severity {severity})"
                for category, severity in categories_analysis.items()
                if (severity or 0) >= self.settings.severity_threshold
            )
            or None
        )
        details = "Detected " + details if details else None

        return AzureContentSafetyResult(score=score, passed=passed, details=details)
