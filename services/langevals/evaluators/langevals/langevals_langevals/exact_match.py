import json
from typing import Any, Optional
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

        # Recover the underlying value on each side (json.loads recovers
        # bools and numbers from their string-coerced form) and compare with
        # ECMA 7.2.13 loose semantics. An upstream evaluator that emits
        # `passed: true` then surfaces as the string "true" through the
        # coercion layer — without this layer it would mismatch a dataset
        # golden of "1". The transform chain (trim/punct/case) is left for
        # the genuinely-text-vs-text case so unrelated strings never collide.
        if _js_loose_equal(output_text, expected_output_text):
            return ExactMatchResult(
                score=1,
                passed=True,
                details=f'{output_text} == {expected_output_text}',
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


def _try_json(text: str) -> Any:
    """
    Recover a scalar's underlying value from its string-coerced form.

    The coercion layer (TS routes + nlpgo + python NLP autoparse) hands the
    scorer JSON-canonical strings: 'true' / 'false' for booleans, '42' /
    '0.5' for numbers, raw text otherwise. json.loads inverts that mapping
    exactly so the scorer can compare types semantically, falling back to
    the original string when the value is plain prose.
    """
    if not isinstance(text, str):
        return text
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError, TypeError):
        return text


def _js_loose_equal(a: str, b: str) -> bool:
    """
    ECMA 7.2.13 abstract equality, scoped to the scalar types the scorer can
    receive (string, bool, number). Returns False for any pair that needs
    the existing transform-chain fall-through (two free-form strings, a
    non-scalar, or a type pairing where ECMA would say not-equal).
    """
    left = _try_json(a)
    right = _try_json(b)

    if isinstance(left, (list, dict)) or isinstance(right, (list, dict)):
        return False

    left_num = _to_number(left)
    right_num = _to_number(right)
    if left_num is not None and right_num is not None:
        return left_num == right_num

    return False


def _to_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None
