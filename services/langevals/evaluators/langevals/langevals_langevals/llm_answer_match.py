import re

import litellm
from pydantic import Field
from typing import Optional
import dspy

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
from litellm.cost_calculator import cost_per_token


class LLMAnswerMatchEntry(EvaluatorEntry):
    input: Optional[str] = Field(default="")
    output: str = Field(default="")
    expected_output: str = Field(default="")


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
        total_tokens = len(
            litellm.encode(  # type: ignore
                model=self.settings.model,
                text=f"{entry.input} {entry.output} {entry.expected_output}",
            )
        )
        max_tokens = min(self.settings.max_tokens, MAX_TOKENS_HARD_LIMIT)
        if total_tokens > max_tokens:
            return EvaluationResultSkipped(
                details=f"Total tokens exceed the maximum of {max_tokens}: {total_tokens}"
            )

        lm = model_to_dspy_lm(self.settings.model)
        dspy.settings.configure(experimental=True)

        answer_match = dspy.Predict(
            LLMAnswerMatchSignature.with_instructions(self.settings.prompt)
        )
        answer_match.set_lm(lm)

        result = answer_match(
            question=entry.input,
            gold_answer=entry.expected_output,
            predicted_answer=entry.output,
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
            details=result.reasoning,
            cost=Money(amount=cost, currency="USD") if cost is not None else None,
        )


_CLAUDE_MODEL_VERSION = re.compile(
    # Matches the modern `claude-<family>-<major>[-<minor>]` naming, with or
    # without a provider prefix (`anthropic/`, `bedrock/anthropic.`) and with or
    # without the trailing 8-digit snapshot date. The negative lookahead keeps a
    # date like `claude-opus-4-20250514` from being read as minor version 20.
    r"claude-(?P<family>[a-z]+)-(?P<major>\d+)(?:-(?P<minor>\d{1,2})(?!\d))?"
)

# First version of each Claude family that rejects an explicit `temperature`.
# The deprecation landed at a different version per family, so a substring
# check cannot express it: `claude-opus-4` also matches Opus 4, 4.1, 4.5 and
# 4.6, which all still accept the parameter.
_TEMPERATURE_REJECTED_FROM = {
    "opus": (4, 7),
    "haiku": (4, 5),
}
# Every family deprecated it no later than its 5 generation, which is what an
# unlisted family (sonnet, and any family released after this) falls back to.
_DEFAULT_TEMPERATURE_REJECTED_FROM = (5, 0)


def claude_rejects_temperature(model: str) -> bool:
    """
    Whether Anthropic rejects an explicit `temperature` for this model.

    These models answer any explicit `temperature` with a hard 400 from
    Anthropic's own API ("temperature is deprecated for this model").
    `drop_params=True` only covers parameters litellm can strip client-side,
    not a server-side rejection, so the parameter has to be left out entirely.
    """
    match = _CLAUDE_MODEL_VERSION.search(model)
    if not match:
        return False

    version = (int(match.group("major")), int(match.group("minor") or 0))
    rejected_from = _TEMPERATURE_REJECTED_FROM.get(
        match.group("family"), _DEFAULT_TEMPERATURE_REJECTED_FROM
    )
    return version >= rejected_from


def model_to_dspy_lm(model: str) -> dspy.LM:
    llm_params = {}
    if "azure/" in model:
        llm_params["api_version"] = "2023-07-01-preview"

    if "gpt-5" in model:
        # gpt-5 needs a specific forced value rather than omission.
        llm_params["temperature"] = 1.0
    elif claude_rejects_temperature(model):
        pass
    else:
        llm_params["temperature"] = 0

    lm = dspy.LM(
        model=model,
        drop_params=True,
        model_type="chat",
        max_tokens=None,
        **llm_params,
    )
    return lm
