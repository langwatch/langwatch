import litellm
from litellm import get_max_tokens, completion_cost
from litellm import ModelResponse, Choices, Message
from litellm.utils import trim_messages

from pydantic import BaseModel, Field
from typing import List, Optional, Literal, cast
import os
import json

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
    Money,
)


class CompetitorLLMFunctionCallEntry(EvaluatorEntry):
    output: Optional[str] = None
    input: Optional[str] = None


class CompetitorLLMFunctionCallSettings(LLMEvaluatorSettings):
    name: str = Field(default="LangWatch", description="The name of your company")
    description: str = Field(
        default="We are providing an LLM observability and evaluation platform",
        description="Description of what your company is specializing at",
    )
    competitors: List[str] = Field(
        default=["OpenAI", "Google", "Microsoft"],
        description="The competitors that must not be mentioned.",
    )



class CompetitorLLMFunctionCallResult(EvaluationResult):
    score: float = Field(description="Number of unique competitors mentioned")
    passed: Optional[bool] = Field(
        description="Is the message related to the competitors", default=True
    )


class CompetitorLLMFunctionCallEvaluator(
    BaseEvaluator[CompetitorLLMFunctionCallEntry, CompetitorLLMFunctionCallSettings, CompetitorLLMFunctionCallResult]
):
    """
    This evaluator implements LLM-as-a-judge with a function call approach to check if the message contains a mention of a competitor.
    """

    name = "Competitor LLM Check"
    category = "policy"
    env_vars = []
    default_settings = CompetitorLLMFunctionCallSettings()
    is_guardrail = True

    def evaluate(self, entry: CompetitorLLMFunctionCallEntry) -> SingleEvaluationResult:
        passed = True
        vendor, model = self.settings.model.split("/")
        if vendor == "azure":
            os.environ["AZURE_API_KEY"] = self.get_env("AZURE_API_KEY")
            os.environ["AZURE_API_BASE"] = self.get_env("AZURE_API_BASE")
            os.environ["AZURE_API_VERSION"] = "2023-07-01-preview"
        content = ""
        content += entry.input if entry.input else ""
        content += "\n" + entry.output if entry.output else ""
        if not content:
            return EvaluationResultSkipped(details="Input and Output are empty")
        your_company_description = (
            f"{self.settings.name} - {self.settings.description}"
        )
        competitors = ""
        for competitor in self.settings.competitors:
            competitors += competitor + "\n"
        litellm_model = model if vendor == "openai" and model != "gpt-4o" else f"{vendor}/{model}"
        prompt = f"""Remember that you are an advanced competitor detection system, developed by {your_company_description}.
                    Your task is to identify mentions of competitors in any given message.
                    The competitors specialize in the same field as your company and are listed below:

                    Competitors:
                    {competitors}

                    Identify if the competitor was mentioned in the following message: {content}"""
        max_tokens_retrieved = get_max_tokens(
            "gpt-4-turbo" if litellm_model == "openai/gpt-4o" else litellm_model
        )
        if max_tokens_retrieved is None:
            raise ValueError("Model not mapped yet, cannot retrieve max tokens.")
        llm_max_tokens: int = int(max_tokens_retrieved)
        max_tokens = (
            min(self.settings.max_tokens, llm_max_tokens)
            if self.settings.max_tokens
            else llm_max_tokens
        )
        messages = [
            {
                "role": "user",
                "content": prompt,
            },
        ]
        messages = cast(
            List[dict[str, str]],
            trim_messages(
                messages,
                (
                    "openai/gpt-4-turbo"
                    if litellm_model == "openai/gpt-4o"
                    else litellm_model
                ),
                max_tokens=max_tokens,
            ),
        )
        response = litellm.completion(
            model=litellm_model,
            messages=messages,
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "competitor_check",
                        "description": "Check if any competitor was mentioned",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "reasoning": {
                                    "type": "string",
                                    "description": "Explain why you think the competitor was or was not mentioned.",
                                },
                                "confidence": {
                                    "type": "number",
                                    "description": "Confidence that the competitor was mentioned on the scale from 0 to 1.",
                                },
                                "competitor_mentioned": {
                                    "type": "boolean",
                                    "description": "True - If the competitor is mentioned, False - if not.",
                                },
                            },
                            "required": [
                                "confidence",
                                "reasoning",
                                "competitor_mentioned"
                            ],
                        },
                    },
                },
            ],
        )
        response = cast(ModelResponse, response)
        choice = cast(Choices, response.choices[0])
        arguments = json.loads(
            cast(Message, choice.message).tool_calls[0].function.arguments
        )
        passed = not arguments["competitor_mentioned"] if "competitor_mentioned" in arguments else True
        confidence = arguments["confidence"] if "confidence" in arguments else 1
        reasoning = arguments["reasoning"] if "reasoning" in arguments else "No reasoning."
        cost = completion_cost(completion_response=response, prompt=prompt)
        details = None
        if not passed:
            details = f"{confidence} - confidence score. Reasoning: {reasoning}"
        print(details)
        return CompetitorLLMFunctionCallResult(
            score=float(confidence),
            passed=passed,
            details=details,
            cost=Money(amount=cost, currency="USD") if cost else None,
        )


