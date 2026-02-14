from typing import Optional
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
)
from pydantic import Field


class ExactMatchSettings(EvaluatorSettings):
    case_sensitive: bool = Field(
        default=False,
        description="True if the comparison should be case-sensitive, False otherwise",
    )
    trim_whitespace: bool = Field(
        default=True,
        description="True if the comparison should trim whitespace, False otherwise",
    )
    remove_punctuation: bool = Field(
        default=True,
        description="True if the comparison should remove punctuation, False otherwise",
    )


class ExactMatchResult(EvaluationResult):
    passed: Optional[bool] = Field(
        default=True,
        description="True if the output matched the expected_output exactly, False otherwise",
    )


class ExactMatchEntry(EvaluatorEntry):
    output: str = None
    expected_output: str = None


class ExactMatchEvaluator(
    BaseEvaluator[ExactMatchEntry, ExactMatchSettings, ExactMatchResult]
):
    """
    A simple evaluator that checks if the output matches the expected_output exactly.
    """

    name = "Exact Match Evaluator"
    category = "quality"
    default_settings = ExactMatchSettings()
    is_guardrail = False

    def evaluate(self, entry: ExactMatchEntry) -> SingleEvaluationResult:
        output_text = entry.output or ""
        expected_output_text = entry.expected_output or ""

        if self.is_float(output_text) and self.is_float(expected_output_text):
            passed = float(output_text) == float(expected_output_text)
            return ExactMatchResult(
                score=1 if passed else 0,
                passed=passed,
                details=f'{output_text} == {expected_output_text}' if passed else f'Expected {output_text} to be equal to {expected_output_text}',
            )

        if self.settings.trim_whitespace:
            output_text = output_text.strip()
            expected_output_text = expected_output_text.strip()

        if self.settings.remove_punctuation:
            output_text = "".join(
                char for char in output_text if char.isalnum() or char.isspace()
            )
            expected_output_text = "".join(
                char
                for char in expected_output_text
                if char.isalnum() or char.isspace()
            )

        if not self.settings.case_sensitive:
            output_text = output_text.lower()
            expected_output_text = expected_output_text.lower()

        passed = output_text == expected_output_text

        return ExactMatchResult(score=1 if passed else 0, passed=passed, details=f'{output_text} == {expected_output_text}' if passed else f'Expected:\n\t"{output_text}"\n\nTo be exactly equal to:\n\t"{expected_output_text}"')

    def is_float(self, text: str) -> bool:
        try:
            float(text)
        except ValueError:
            return False
        return True
