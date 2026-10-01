import litellm
from pydantic import Field
from typing import Optional
import dspy

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
    Money,
)
from litellm.cost_calculator import cost_per_token
from langevals_core.token_budget import fit_judge_content

# DSPy's own framing around the three fields and the two answers, counted
# against the budget with the prompt.
ANSWER_MATCH_SIGNATURE_TEXT = (
    "Your input fields are: question, gold_answer (correct answer for question), "
    "predicted_answer. Your output fields are: reasoning, is_correct (True or False). "
    "All interactions will be structured with each field in its own section."
)


class LLMAnswerMatchEntry(EvaluatorEntry):
    # The question is context the judge can work without. The two answers are
    # the comparison itself: with either one missing the judge is asked whether
    # nothing matches nothing, and answers yes.
    input: Optional[str] = Field(default="")
    output: str
    expected_output: str


class LLMAnswerMatchSettings(LLMEvaluatorSettings):
    prompt: str = Field(
        default="Verify that the predicted answer matches the gold answer for the question. Style does not matter, for example the gold answer may be more direct while the predicted answer more verbose and still be correct.",
        description="Prompt for the comparison",
    )


class LLMAnswerMatchResult(EvaluationResult):
    passed: bool = Field(
        description="Whether the predicted answer matches the gold answer", default=True
    )
    details: Optional[str] = Field(default=None)


class LLMAnswerMatchSignature(dspy.Signature):
    question = dspy.InputField()
    gold_answer = dspy.InputField(desc="correct answer for question")
    predicted_answer = dspy.InputField(desc="predicted answer for question")
    reasoning = dspy.OutputField(desc="reasoning for the answer")
    is_correct = dspy.OutputField(desc="True or False")


class LLMAnswerMatchEvaluator(
    BaseEvaluator[
        LLMAnswerMatchEntry,
        LLMAnswerMatchSettings,
        LLMAnswerMatchResult,
    ]
):
    """
    Uses an LLM to check if the generated output answers a question correctly the same way as the expected output, even if their style is different.
    """

    name = "LLM Answer Match"
    category = "quality"
    env_vars = []
    is_guardrail = False

    def evaluate(self, entry: LLMAnswerMatchEntry) -> SingleEvaluationResult:
        fitted = fit_judge_content(
            model=self.settings.model,
            max_tokens=self.settings.max_tokens,
            reserved_texts=[self.settings.prompt, ANSWER_MATCH_SIGNATURE_TEXT],
            input=entry.input,
            output=entry.output,
            expected_output=entry.expected_output,
        )
        if isinstance(fitted, EvaluationResultSkipped):
            return fitted

        lm = model_to_dspy_lm(self.settings.model)

        answer_match = dspy.Predict(
            LLMAnswerMatchSignature.with_instructions(self.settings.prompt)
        )
        answer_match.set_lm(lm)

        result = answer_match(
            question=fitted.input,
            gold_answer=fitted.expected_output,
            predicted_answer=fitted.output,
        )

        last_response = lm.history[-1]
        cost = None
        if last_response:
            try:
                input_cost, output_cost = cost_per_token(
                    model=self.settings.model,
                    prompt_tokens=last_response.get("usage", {}).get(
                        "prompt_tokens", 0
                    ),
                    completion_tokens=last_response.get("usage", {}).get(
                        "completion_tokens", 0
                    ),
                )
                cost = input_cost + output_cost
            except Exception as e:
                if "This model isn't mapped yet" in str(e):
                    pass
                else:
                    raise e

        passed = "true" in str(result.is_correct).lower()

        return LLMAnswerMatchResult(
            passed=passed,
            score=1 if passed else 0,
            details=fitted.with_note(result.reasoning),
            cost=Money(amount=cost, currency="USD") if cost is not None else None,
        )


def model_to_dspy_lm(model: str) -> dspy.LM:
    llm_params = {}
    if "azure/" in model:
        llm_params["api_version"] = "2023-07-01-preview"

    lm = dspy.LM(
        model=model,
        temperature=1.0 if "gpt-5" in model else 0,
        drop_params=True,
        model_type="chat",
        max_tokens=None,
        **llm_params,
    )
    return lm
