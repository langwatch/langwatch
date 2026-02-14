from typing import Optional
from httpx import Client, Response
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
    EvaluatorEntry,
    EvaluationResultSkipped,
)
from pydantic import Field


class AzureJailbreakEntry(EvaluatorEntry):
    input: str


class AzureJailbreakSettings(EvaluatorSettings):
    pass


class AzureJailbreakResult(EvaluationResult):
    passed: Optional[bool] = Field(
        default=None,
        description="If true then no jailbreak was detected, if false then a jailbreak was detected"
    )


class AzureJailbreakEvaluator(
    BaseEvaluator[AzureJailbreakEntry, AzureJailbreakSettings, AzureJailbreakResult]
):
    """
    This evaluator checks for jailbreak-attempt in the input using Azure's Content Safety API.
    """

    name = "Azure Jailbreak Detection"
    category = "safety"
    env_vars = ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"]
    default_settings = AzureJailbreakSettings()
    is_guardrail = True

    def evaluate(self, entry: AzureJailbreakEntry) -> SingleEvaluationResult:
        endpoint = self.get_env("AZURE_CONTENT_SAFETY_ENDPOINT")
        key = self.get_env("AZURE_CONTENT_SAFETY_KEY")
        url = f"{endpoint}/contentsafety/text:detectJailbreak?api-version=2023-10-15-preview"

        content = entry.input or ""
        if not content:
            return EvaluationResultSkipped(details="Input is empty")

        headers = {
            "Content-Type": "application/json",
            "Ocp-Apim-Subscription-Key": key,
        }

        detected = False
        for i in range(0, len(content), 1000):
            body = {"text": content[i : i + 1000]}
            with Client() as client:
                response: Response = client.post(url, headers=headers, json=body)

            if response.is_error:
                raise ValueError(f"Error in API response: {response.text}")

            result = response.json()
            detected = result.get("jailbreakAnalysis", {}).get("detected", False)
            if detected:
                break

        return AzureJailbreakResult(
            score=1 if detected else 0,
            passed=not detected,
            details="Jailbreak attempt detected" if detected else None,
        )
