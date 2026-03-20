import json
import os
from typing import Optional, Union, cast
from langevals_core.base_evaluator import (
    MAX_TOKENS_HARD_LIMIT,
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
    Money,
)
from langevals_core.image_support import build_content_parts, ContentPart
from pydantic import BaseModel, Field
import litellm
from litellm import Choices, Message
from litellm.types.utils import ModelResponse
from litellm.cost_calculator import completion_cost
from litellm.utils import encode
import dspy


class CustomLLMCategoryEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None
    contexts: Optional[list[str]] = None


class CustomLLMCategoryDefinition(BaseModel):
    name: str
    description: str


class CustomLLMCategorySettings(LLMEvaluatorSettings):
    prompt: str = Field(
        default="You are an LLM category evaluator. Please categorize the message in one of the following categories",
        description="The system prompt to use for the LLM to run the evaluation",
    )
    categories: list[CustomLLMCategoryDefinition] = Field(
        default=[
            CustomLLMCategoryDefinition(
                name="smalltalk",
                description="Smalltalk with the user",
            ),
            CustomLLMCategoryDefinition(
                name="company",
                description="Questions about the company, what we do, etc",
            ),
        ],
        description="The categories to use for the evaluation",
    )


class CustomLLMCategoryResult(EvaluationResult):
    label: Optional[str] = Field(
        default=None, description="The detected category of the message"
    )


class CustomLLMCategoryEvaluator(
    BaseEvaluator[
        CustomLLMCategoryEntry, CustomLLMCategorySettings, CustomLLMCategoryResult
    ]
):
    """
    Use an LLM as a judge with a custom prompt to classify the message into custom defined categories.
    """

    name = "LLM-as-a-Judge Category Evaluator"
    category = "custom"
    env_vars = []
    default_settings = CustomLLMCategorySettings()
    is_guardrail = False

    def evaluate(self, entry: CustomLLMCategoryEntry) -> SingleEvaluationResult:
        os.environ["AZURE_API_VERSION"] = "2023-12-01-preview"
        if self.env:
            for key, env in self.env.items():
                os.environ[key] = env

        if not entry.input and not entry.output and not entry.contexts:
            return EvaluationResultSkipped(details="No content to evaluate")

        categories_text = "\n\n# Categories\n" + "\n".join(
            [
                f"- {category.name}: {category.description}"
                for category in self.settings.categories
            ]
        )

        task_with_categories = f"{self.settings.prompt}{categories_text}"

        content: Union[str, list[ContentPart]] = build_content_parts(
            input=entry.input,
            output=entry.output,
            contexts=entry.contexts,
            task=task_with_categories,
        )

        # Token counting uses the plain-text version for estimation
        content_text = content if isinstance(content, str) else " ".join(
            p["text"] for p in content if p.get("type") == "text"  # type: ignore
        )
        total_tokens = len(
            encode(model=self.settings.model, text=f"{self.settings.prompt} {content_text}")
        )
        max_tokens = min(self.settings.max_tokens, MAX_TOKENS_HARD_LIMIT)
        if total_tokens > max_tokens:
            return EvaluationResultSkipped(
                details=f"Total tokens exceed the maximum of {max_tokens}: {total_tokens}"
            )

        cost = None
        response = litellm.completion(
            model=self.settings.model,
            messages=[
                {
                    "role": "system",
                    "content": self.settings.prompt
                    + ". Always output a valid json for the function call",
                },
                {
                    "role": "user",
                    "content": content,
                },
            ],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "evaluation",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "reasoning": {
                                    "type": "string",
                                    "description": "use this field to ponder and write a short reasoning behind the decision written before a result is actually given",
                                },
                                "label": {
                                    "type": "string",
                                    "description": "the final decision of the category for the message",
                                    "enum": [
                                        category.name
                                        for category in self.settings.categories
                                    ],
                                },
                            },
                            "required": ["reasoning", "label"],
                        },
                        "description": "use this function to write your thoughts on the reasoning, then decide if it passed or not with this json structure",
                    },
                },
            ],
            tool_choice={"type": "function", "function": {"name": "evaluation"}},  # type: ignore
        )

        response = cast(ModelResponse, response)
        choice = cast(Choices, response.choices[0])
        arguments = json.loads(
            cast(Message, choice.message).tool_calls[0].function.arguments  # type: ignore
        )
        cost = completion_cost(completion_response=response)

        return CustomLLMCategoryResult(
            label=arguments["label"],
            details=arguments["reasoning"],
            cost=Money(amount=cost, currency="USD") if cost else None,
        )
