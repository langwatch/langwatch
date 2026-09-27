from typing import Optional, Union, cast
from langevals_core.tool_calls import read_tool_call_arguments
from langevals_core.litellm_patch import azure_api_version
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
    Money,
)
from langevals_core.image_support import build_content_parts, ContentPart
from langevals_core.token_budget import fit_judge_content
from pydantic import BaseModel, Field
import litellm
from litellm.types.utils import ModelResponse
from litellm.cost_calculator import completion_cost
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
        if not entry.input and not entry.output and not entry.contexts:
            return EvaluationResultSkipped(details="No content to evaluate")

        categories_text = "\n\n# Categories\n" + "\n".join(
            [
                f"- {category.name}: {category.description}"
                for category in self.settings.categories
            ]
        )

        task_with_categories = f"{self.settings.prompt}{categories_text}"

        system_prompt = self.settings.prompt + ". Always output a valid json for the function call"
        fitted = fit_judge_content(
            model=self.settings.model,
            max_tokens=self.settings.max_tokens,
            reserved_texts=[system_prompt, task_with_categories],
            input=entry.input,
            output=entry.output,
            contexts=entry.contexts,
        )
        if isinstance(fitted, EvaluationResultSkipped):
            return fitted

        content: Union[str, list[ContentPart]] = build_content_parts(
            input=fitted.input,
            output=fitted.output,
            contexts=fitted.contexts,
            task=task_with_categories,
        )

        cost = None
        response = litellm.completion(
            model=self.settings.model,
            **azure_api_version(self.settings.model, "2023-12-01-preview"),
            messages=[
                {
                    "role": "system",
                    "content": system_prompt,
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
                                    "description": "a short reasoning for the decision, written before the label",
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
                        "description": "Record the category of the message: a short reasoning first, then the label.",
                    },
                },
            ],
            tool_choice={"type": "function", "function": {"name": "evaluation"}},  # type: ignore
        )

        response = cast(ModelResponse, response)
        arguments = read_tool_call_arguments(
            response,
            "evaluation",
            required=["reasoning", "label"],
            model=self.settings.model,
        )
        cost = completion_cost(completion_response=response)

        return CustomLLMCategoryResult(
            label=arguments["label"],
            details=fitted.with_note(arguments["reasoning"]),
            cost=Money(amount=cost, currency="USD") if cost else None,
        )
