from typing import Optional, cast
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
from langevals_core.image_support import build_content_parts
from langevals_core.token_budget import fit_judge_content
from pydantic import Field
import litellm
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
        if not entry.input and not entry.output and not entry.contexts:
            return EvaluationResultSkipped(details="No content to evaluate")

        system_prompt = self.settings.prompt + ". Always output a valid json for the function call"
        fitted = fit_judge_content(
            model=self.settings.model,
            max_tokens=self.settings.max_tokens,
            reserved_texts=[system_prompt, self.settings.prompt],
            input=entry.input,
            output=entry.output,
            contexts=entry.contexts,
        )
        if isinstance(fitted, EvaluationResultSkipped):
            return fitted

        content = build_content_parts(
            input=fitted.input,
            output=fitted.output,
            contexts=fitted.contexts,
            task=self.settings.prompt,
        )
        content_text = content if isinstance(content, str) else " ".join(
            p["text"] for p in content if p.get("type") == "text"  # type: ignore
        )

        cost = None

        if "atla-selene" in self.settings.model:

            class LLMJudge(dspy.Signature):
                content: str = dspy.InputField()
                reasoning: str = dspy.OutputField()
                final_score: float = dspy.OutputField()

            judge = dspy.Predict(LLMJudge.with_instructions(self.settings.prompt))
            judge.set_lm(lm=dspy.LM(model=self.settings.model))
            # dspy path always uses plain text
            dspy_content = content if isinstance(content, str) else content_text
            arguments = judge(content=dspy_content)

        else:
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
                                        "description": "A short justification, written before the score: the parts of the task, the evidence in the content for each (quote the values or name the tool result), and how they combine into the final score",
                                    },
                                    "final_score": {
                                        "type": "number",
                                        "description": "your final score for the task",
                                    },
                                },
                                "required": ["reasoning", "final_score"],
                            },
                            "description": "Record the evaluation: a short justification that cites the evidence in the content, then the final score.",
                        },
                    },
                ],
                tool_choice={"type": "function", "function": {"name": "evaluation"}},  # type: ignore
            )

            response = cast(ModelResponse, response)
            arguments = read_tool_call_arguments(
                response,
                "evaluation",
                required=["reasoning", "final_score"],
                model=self.settings.model,
            )
            cost = completion_cost(completion_response=response)

        return CustomLLMScoreResult(
            score=arguments["final_score"],
            details=fitted.with_note(arguments["reasoning"]),
            cost=Money(amount=cost, currency="USD") if cost else None,
        )
