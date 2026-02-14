from typing import Optional, List
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
import math


class AzurePromptShieldEntry(EvaluatorEntry):
    input: str
    contexts: Optional[List[str]] = None


class AzurePromptShieldSettings(EvaluatorSettings):
    pass


class AzurePromptShieldResult(EvaluationResult):
    passed: Optional[bool] = Field(
        default=None,
        description="If true then no prompt injection was detected, if false then a prompt injection was detected",
    )


class AzurePromptShieldEvaluator(
    BaseEvaluator[
        AzurePromptShieldEntry, AzurePromptShieldSettings, AzurePromptShieldResult
    ]
):
    """
    This evaluator checks for prompt injection attempt in the input and the contexts using Azure's Content Safety API.
    """

    name = "Azure Prompt Shield"
    category = "safety"
    env_vars = ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"]
    default_settings = AzurePromptShieldSettings()
    docs_url = "https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection"
    is_guardrail = True

    def evaluate(self, entry: AzurePromptShieldEntry) -> SingleEvaluationResult:
        endpoint = self.get_env("AZURE_CONTENT_SAFETY_ENDPOINT")
        key = self.get_env("AZURE_CONTENT_SAFETY_KEY")
        url = (
            f"{endpoint}/contentsafety/text:shieldPrompt?api-version=2024-02-15-preview"
        )

        content = entry.input or ""
        if not content:
            return EvaluationResultSkipped(details="Input is empty")
        contexts = entry.contexts or []
        headers = {
            "Content-Type": "application/json",
            "Ocp-Apim-Subscription-Key": key,
        }

        steps = max(1, math.ceil(len(content) / 10000))
        batch_size = max(1, math.ceil(len(contexts) / steps))
        detected = False
        prompt_result = False
        document_results_detected = False
        for i in range(0, len(content), 10000):
            batch_end = min((i // 10000 + 1) * batch_size, len(contexts))
            body = {
                "userPrompt": content[i : i + 10000],
                "documents": contexts[i // 10000 * batch_size : batch_end],
            }
            with Client() as client:
                response: Response = client.post(url, headers=headers, json=body)

            if response.is_error:
                raise ValueError(f"Error in API response: {response.text}")

            result = response.json()
            prompt_result = result.get("userPromptAnalysis", {}).get(
                "attackDetected", False
            )
            document_results = [
                doc.get("attackDetected", False)
                for doc in result.get("documentsAnalysis", [])
            ]

            if any(document_results):
                document_results_detected = True

            if prompt_result or document_results_detected:
                detected = True
                break

        details = None
        if prompt_result and document_results_detected:
            details = "User Prompt Injection attempt and Malicious Contexts detected"
        elif prompt_result:
            details = "User Prompt Injection attempt detected"
        elif document_results_detected:
            details = "Malicious Contexts detected"

        return AzurePromptShieldResult(
            score=1 if detected else 0, passed=not detected, details=details
        )
