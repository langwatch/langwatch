import json
import os
from typing import Optional, cast
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
from pydantic import Field
import litellm
from litellm import Choices, Message
from litellm.files.main import ModelResponse
from litellm.cost_calculator import completion_cost
import dspy


class CustomLLMScoreEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None
    contexts: Optional[list[str]] = None


class CustomLLMScoreSettings(LLMEvaluatorSettings):
    prompt: str = Field(
        default="You are an LLM evaluator. Please score from 0.0 to 1.0 how likely the user is to be satisfied with this answer, from 0.0 being not satisfied at all to 1.0 being completely satisfied",
        description="The system prompt to use for the LLM to run the evaluation",
    )


class CustomLLMScoreResult(EvaluationResult):
    score: float = Field(
        default=0.0, description="The score given by the LLM, according to the prompt"
    )


class CustomLLMScoreEvaluator(
    BaseEvaluator[CustomLLMScoreEntry, CustomLLMScoreSettings, CustomLLMScoreResult]
):
    """
    Use an LLM as a judge with custom prompt to do a numeric score evaluation of the message.
    """

    name = "LLM-as-a-Judge Score Evaluator"
    category = "custom"
    env_vars = []
    default_settings = CustomLLMScoreSettings()
    is_guardrail = False

    def evaluate(self, entry: CustomLLMScoreEntry) -> SingleEvaluationResult:
        if self.env:
            for key, env in self.env.items():
                os.environ[key] = env

        content = ""
        if entry.input:
            content += f"# Input\n{entry.input}\n\n"
        if entry.output:
            content += f"# Output\n{entry.output}\n\n"
        if entry.contexts:
            content += f"# Contexts\n{'1. '.join(entry.contexts)}\n\n"

        if not content:
            return EvaluationResultSkipped(details="No content to evaluate")

        content += f"# Task\n{self.settings.prompt}"

        total_tokens = len(
            litellm.encode(  # type: ignore
                model=self.settings.model, text=f"{self.settings.prompt} {content}"
            )
        )
        max_tokens = min(self.settings.max_tokens, MAX_TOKENS_HARD_LIMIT)
        if total_tokens > max_tokens:
            return EvaluationResultSkipped(
                details=f"Total tokens exceed the maximum of {max_tokens}: {total_tokens}"
            )

        cost = None

        if "atla-selene" in self.settings.model:

            class LLMJudge(dspy.Signature):
                content: str = dspy.InputField()
                reasoning: str = dspy.OutputField()
                final_score: float = dspy.OutputField()

            judge = dspy.Predict(LLMJudge.with_instructions(self.settings.prompt))
            judge.set_lm(lm=dspy.LM(model=self.settings.model))
            arguments = judge(content=content)

        else:
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
                                        "description": "use this field to break down the task and explain your reasoning in multiple sub-scores, using it to combine into a final score",
                                    },
                                    "final_score": {
                                        "type": "number",
                                        "description": "your final score for the task",
                                    },
                                },
                                "required": ["reasoning", "final_score"],
                            },
                            "description": "use this function to write your thoughts on the reasoning, then decide on the final score with this json structure",
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

        return CustomLLMScoreResult(
            score=arguments["final_score"],
            details=arguments["reasoning"],
            cost=Money(amount=cost, currency="USD") if cost else None,
        )
