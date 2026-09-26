from typing import Literal, Optional, cast
from langevals_core.litellm_patch import azure_api_version
from langevals_core.base_evaluator import (
    MAX_TOKENS_HARD_LIMIT,
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    EvaluatorSettings,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
    Money,
)
from langevals_core.image_support import build_content_parts
from langevals_core.tool_calls import (
    JudgeAnswerError,
    read_boolean,
    read_tool_call_arguments,
)
from pydantic import BaseModel, Field
import litellm
from litellm.files.main import ModelResponse
from litellm.cost_calculator import completion_cost
import dspy


# Most customer prompts state a fail condition ("return false if the answer
# mentions a competitor"). The field is named `result`, not `passed`, and
# every description says it carries the value the instructions ask for, so a
# judge never flips it into its own "did the output pass" reading.
RESULT_FRAMING = (
    "Answer by calling the `evaluation` function, setting `result` to exactly the "
    "true or false value the instructions above ask you to return. If they say "
    "when to return false, return false in that case and true in every other "
    "case. If they say when to return true, return true in that case and false "
    "in every other case. `result` is not a rating of the output, never invert it."
)

EVALUATION_TOOL = {
    "type": "function",
    "function": {
        "name": "evaluation",
        "description": (
            "Record the true or false value the instructions ask for. Write a "
            "short reasoning first, then the result."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reasoning": {
                    "type": "string",
                    "description": (
                        "A short reasoning, written before the result: name the "
                        "condition the instructions give and the value they ask for "
                        "when it holds, say whether it holds for this content, then "
                        "state the value that follows."
                    ),
                },
                "result": {
                    "type": "boolean",
                    "description": (
                        "Exactly the value the instructions ask you to return. If they "
                        "say when to return false: false in that case, true otherwise. "
                        "If they say when to return true: true in that case, false "
                        "otherwise. Not a judgment of whether the content is good."
                    ),
                },
            },
            "required": ["reasoning", "result"],
        },
    },
}


def judge_system_prompt(prompt: str) -> str:
    return f"{prompt}\n\n{RESULT_FRAMING}"


class CustomLLMBooleanEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None
    contexts: Optional[list[str]] = None


class CustomLLMBooleanSettings(LLMEvaluatorSettings):
    prompt: str = Field(
        default="You are an LLM evaluator. We need the guarantee that the output answers what is being asked on the input, please evaluate as False if it doesn't",
        description="The system prompt to use for the LLM to run the evaluation",
    )


class CustomLLMBooleanResult(EvaluationResult):
    score: float = Field(default=0.0)
    passed: Optional[bool] = Field(
        description="The veredict given by the LLM", default=True
    )


class CustomLLMBooleanEvaluator(
    BaseEvaluator[
        CustomLLMBooleanEntry, CustomLLMBooleanSettings, CustomLLMBooleanResult
    ]
):
    """
    Use an LLM as a judge with a custom prompt to do a true/false boolean evaluation of the message.
    """

    name = "LLM-as-a-Judge Boolean Evaluator"
    category = "custom"
    env_vars = []
    default_settings = CustomLLMBooleanSettings()
    is_guardrail = True

    def evaluate(self, entry: CustomLLMBooleanEntry) -> SingleEvaluationResult:
        if not entry.input and not entry.output and not entry.contexts:
            return EvaluationResultSkipped(details="No content to evaluate")

        content = build_content_parts(
            input=entry.input,
            output=entry.output,
            contexts=entry.contexts,
            task=self.settings.prompt,
        )

        # Token counting uses the plain-text version for estimation
        content_text = content if isinstance(content, str) else " ".join(
            p["text"] for p in content if p.get("type") == "text"  # type: ignore
        )
        total_tokens = len(
            litellm.encode(  # type: ignore
                model=self.settings.model, text=f"{self.settings.prompt} {content_text}"
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
                passed: bool = dspy.OutputField()

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
                        "content": judge_system_prompt(self.settings.prompt),
                    },
                    {
                        "role": "user",
                        "content": content,
                    },
                ],
                tools=[EVALUATION_TOOL],
                tool_choice={"type": "function", "function": {"name": "evaluation"}},  # type: ignore
            )

            response = cast(ModelResponse, response)
            tool_arguments = read_tool_call_arguments(
                response,
                "evaluation",
                required=["reasoning", "result"],
                model=self.settings.model,
            )
            result = read_boolean(tool_arguments["result"])
            if result is None:
                raise JudgeAnswerError(
                    "evaluation",
                    "sent a result that is neither true nor false",
                    self.settings.model,
                )
            arguments = {"passed": result, "reasoning": tool_arguments["reasoning"]}
            cost = completion_cost(completion_response=response)

        return CustomLLMBooleanResult(
            score=1 if arguments["passed"] else 0,
            passed=arguments["passed"],
            details=arguments["reasoning"],
            cost=Money(amount=cost, currency="USD") if cost else None,
        )
