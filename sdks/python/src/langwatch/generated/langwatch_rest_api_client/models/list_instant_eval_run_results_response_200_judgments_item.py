from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.list_instant_eval_run_results_response_200_judgments_item_status import (
    ListInstantEvalRunResultsResponse200JudgmentsItemStatus,
)

if TYPE_CHECKING:
    from ..models.list_instant_eval_run_results_response_200_judgments_item_probabilities_type_0 import (
        ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0,
    )


T = TypeVar("T", bound="ListInstantEvalRunResultsResponse200JudgmentsItem")


@_attrs_define
class ListInstantEvalRunResultsResponse200JudgmentsItem:
    """
    Attributes:
        trace_id (str): The trace the judgement is about.
        question_id (str): The question it answers, named by its output column.
        thread_id (str): The conversation the trace belongs to.
        span_id (str): The span the judged text was read from.
        kind (str): What kind of question was asked.
        status (ListInstantEvalRunResultsResponse200JudgmentsItemStatus): Whether the judge answered, declined, or could
            not answer.
        passed (bool | None): Whether a boolean question passed its threshold.
        score (float | None): A score question's answer.
        label (None | str): A category question's answer.
        probability (float | None): How likely the judge found a boolean question's answer to be true.
        probabilities (ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0 | None): The full
            distribution behind a category answer.
        error (None | str): Why the judge could not answer, when it could not.
        occurred_at (str): When the judgement was made.
    """

    trace_id: str
    question_id: str
    thread_id: str
    span_id: str
    kind: str
    status: ListInstantEvalRunResultsResponse200JudgmentsItemStatus
    passed: bool | None
    score: float | None
    label: None | str
    probability: float | None
    probabilities: ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0 | None
    error: None | str
    occurred_at: str

    def to_dict(self) -> dict[str, Any]:
        from ..models.list_instant_eval_run_results_response_200_judgments_item_probabilities_type_0 import (
            ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0,
        )

        trace_id = self.trace_id

        question_id = self.question_id

        thread_id = self.thread_id

        span_id = self.span_id

        kind = self.kind

        status = self.status.value

        passed: bool | None
        passed = self.passed

        score: float | None
        score = self.score

        label: None | str
        label = self.label

        probability: float | None
        probability = self.probability

        probabilities: dict[str, Any] | None
        if isinstance(self.probabilities, ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0):
            probabilities = self.probabilities.to_dict()
        else:
            probabilities = self.probabilities

        error: None | str
        error = self.error

        occurred_at = self.occurred_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "traceId": trace_id,
                "questionId": question_id,
                "threadId": thread_id,
                "spanId": span_id,
                "kind": kind,
                "status": status,
                "passed": passed,
                "score": score,
                "label": label,
                "probability": probability,
                "probabilities": probabilities,
                "error": error,
                "occurredAt": occurred_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_instant_eval_run_results_response_200_judgments_item_probabilities_type_0 import (
            ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0,
        )

        d = dict(src_dict)
        trace_id = d.pop("traceId")

        question_id = d.pop("questionId")

        thread_id = d.pop("threadId")

        span_id = d.pop("spanId")

        kind = d.pop("kind")

        status = ListInstantEvalRunResultsResponse200JudgmentsItemStatus(d.pop("status"))

        def _parse_passed(data: object) -> bool | None:
            if data is None:
                return data
            return cast(bool | None, data)

        passed = _parse_passed(d.pop("passed"))

        def _parse_score(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        score = _parse_score(d.pop("score"))

        def _parse_label(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        label = _parse_label(d.pop("label"))

        def _parse_probability(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        probability = _parse_probability(d.pop("probability"))

        def _parse_probabilities(
            data: object,
        ) -> ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                probabilities_type_0 = ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0.from_dict(
                    data
                )

                return probabilities_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ListInstantEvalRunResultsResponse200JudgmentsItemProbabilitiesType0 | None, data)

        probabilities = _parse_probabilities(d.pop("probabilities"))

        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))

        occurred_at = d.pop("occurredAt")

        list_instant_eval_run_results_response_200_judgments_item = cls(
            trace_id=trace_id,
            question_id=question_id,
            thread_id=thread_id,
            span_id=span_id,
            kind=kind,
            status=status,
            passed=passed,
            score=score,
            label=label,
            probability=probability,
            probabilities=probabilities,
            error=error,
            occurred_at=occurred_at,
        )

        return list_instant_eval_run_results_response_200_judgments_item
