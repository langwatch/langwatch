import pprint
from typing import Optional

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
)
from pydantic import BaseModel

from langevals.utils import get_evaluator_definitions


class Expectation(BaseModel):
    entry: dict[str, str] = {}

    def _build_entry(self, evaluator: BaseEvaluator):
        evaluator_definitions = get_evaluator_definitions(evaluator)
        return evaluator_definitions.entry_type(**self.entry)

    def evaluate(self, evaluator: BaseEvaluator):
        entry = self._build_entry(evaluator)

        return evaluator.evaluate(entry)

    def to_pass(self, evaluator: BaseEvaluator):
        entry = self._build_entry(evaluator)
        result = self.evaluate(evaluator)
        assert result.status == "processed", (
            result.details
            if result.status == "skipped" or result.status == "error"
            else None
        )
        assert result.passed, self._result_details_print(
            entry, f"{evaluator.name} to_pass FAILED", result.details
        )

    def to_fail(self, evaluator: BaseEvaluator):
        entry = self._build_entry(evaluator)
        result = self.evaluate(evaluator)
        assert result.status == "processed", (
            result.details
            if result.status == "skipped" or result.status == "error"
            else None
        )
        assert not result.passed, self._result_details_print(
            entry, f"{evaluator.name} to_fail FAILED", result.details
        )

    def _result_details_print(
        self, entry: EvaluatorEntry, msg: str, details: Optional[str]
    ):
        return (
            " - ".join([x for x in [msg, details] if x])
            + "\nEntry: "
            + pprint.pformat(entry)
        )

    def score(self, evaluator: BaseEvaluator):
        entry = self._build_entry(evaluator)
        result = self.evaluate(evaluator)
        assert result.status == "processed", (
            result.details
            if result.status == "skipped" or result.status == "error"
            else None
        )
        return NumericExpectation(entry=entry, evaluator=evaluator, result=result)


class NumericExpectation(BaseModel):
    entry: EvaluatorEntry
    evaluator: BaseEvaluator
    result: EvaluationResult

    def _result_details_print(self, msg, value):
        return (
            " - ".join(
                [
                    x
                    for x in [
                        f"{self.evaluator.name} {msg} {value} FAILED (actual: {self.result.score})",
                        self.result.details,
                    ]
                    if x
                ]
            )
            + "\nEntry: "
            + pprint.pformat(self.entry)
        )

    def to_be_greater_than(self, value: float):
        assert self.result.score > value, self._result_details_print(
            "to_be_greater_than", value
        )

    def to_be_less_than(self, value: float):
        assert self.result.score < value, self._result_details_print(
            "to_be_less_than", value
        )

    def to_be_equal_to(self, value: float):
        assert self.result.score == value, self._result_details_print(
            "to_be_equal_to", value
        )

    def to_be_within(self, lower: float, upper: float):
        assert lower <= self.result.score <= upper, self._result_details_print(
            "to_be_within", (lower, upper)
        )

    def to_be_greater_than_or_equal(self, value: float):
        assert self.result.score >= value, self._result_details_print(
            "to_be_greater_or_equal", value
        )

    def to_be_less_than_or_equal(self, value: float):
        assert self.result.score <= value, self._result_details_print(
            "to_be_less_than_or_equal", value
        )


def expect(
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: Optional[list[str]] = None,
    expected_output: Optional[str] = None,
):
    entry = {}
    if input is not None:
        entry["input"] = input
    if output is not None:
        entry["output"] = output
    if contexts is not None:
        entry["contexts"] = contexts
    if expected_output is not None:
        entry["expected_output"] = expected_output

    return Expectation(entry=entry)
