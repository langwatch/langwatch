from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.evaluation_error_type_0 import EvaluationErrorType0
    from ..models.evaluation_inputs_type_0 import EvaluationInputsType0
    from ..models.evaluation_timestamps import EvaluationTimestamps


T = TypeVar("T", bound="Evaluation")


@_attrs_define
class Evaluation:
    """
    Attributes:
        evaluation_id (str):
        evaluator_id (str):
        name (str):
        status (Literal['error'] | Literal['in_progress'] | Literal['processed'] | Literal['scheduled'] |
            Literal['skipped']):
        timestamps (EvaluationTimestamps):
        span_id (None | str | Unset):
        type_ (None | str | Unset):
        is_guardrail (bool | None | Unset):
        evaluation_thread_id (None | str | Unset):
        passed (bool | None | Unset):
        score (float | None | Unset):
        label (None | str | Unset):
        details (None | str | Unset):
        inputs (EvaluationInputsType0 | None | Unset):
        error (EvaluationErrorType0 | None | Unset):
        retries (float | None | Unset):
    """

    evaluation_id: str
    evaluator_id: str
    name: str
    status: Literal["error"] | Literal["in_progress"] | Literal["processed"] | Literal["scheduled"] | Literal["skipped"]
    timestamps: EvaluationTimestamps
    span_id: None | str | Unset = UNSET
    type_: None | str | Unset = UNSET
    is_guardrail: bool | None | Unset = UNSET
    evaluation_thread_id: None | str | Unset = UNSET
    passed: bool | None | Unset = UNSET
    score: float | None | Unset = UNSET
    label: None | str | Unset = UNSET
    details: None | str | Unset = UNSET
    inputs: EvaluationInputsType0 | None | Unset = UNSET
    error: EvaluationErrorType0 | None | Unset = UNSET
    retries: float | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.evaluation_error_type_0 import EvaluationErrorType0
        from ..models.evaluation_inputs_type_0 import EvaluationInputsType0

        evaluation_id = self.evaluation_id

        evaluator_id = self.evaluator_id

        name = self.name

        status: (
            Literal["error"] | Literal["in_progress"] | Literal["processed"] | Literal["scheduled"] | Literal["skipped"]
        )
        status = self.status

        timestamps = self.timestamps.to_dict()

        span_id: None | str | Unset
        if isinstance(self.span_id, Unset):
            span_id = UNSET
        else:
            span_id = self.span_id

        type_: None | str | Unset
        if isinstance(self.type_, Unset):
            type_ = UNSET
        else:
            type_ = self.type_

        is_guardrail: bool | None | Unset
        if isinstance(self.is_guardrail, Unset):
            is_guardrail = UNSET
        else:
            is_guardrail = self.is_guardrail

        evaluation_thread_id: None | str | Unset
        if isinstance(self.evaluation_thread_id, Unset):
            evaluation_thread_id = UNSET
        else:
            evaluation_thread_id = self.evaluation_thread_id

        passed: bool | None | Unset
        if isinstance(self.passed, Unset):
            passed = UNSET
        else:
            passed = self.passed

        score: float | None | Unset
        if isinstance(self.score, Unset):
            score = UNSET
        else:
            score = self.score

        label: None | str | Unset
        if isinstance(self.label, Unset):
            label = UNSET
        else:
            label = self.label

        details: None | str | Unset
        if isinstance(self.details, Unset):
            details = UNSET
        else:
            details = self.details

        inputs: dict[str, Any] | None | Unset
        if isinstance(self.inputs, Unset):
            inputs = UNSET
        elif isinstance(self.inputs, EvaluationInputsType0):
            inputs = self.inputs.to_dict()
        else:
            inputs = self.inputs

        error: dict[str, Any] | None | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, EvaluationErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        retries: float | None | Unset
        if isinstance(self.retries, Unset):
            retries = UNSET
        else:
            retries = self.retries

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "evaluation_id": evaluation_id,
                "evaluator_id": evaluator_id,
                "name": name,
                "status": status,
                "timestamps": timestamps,
            }
        )
        if span_id is not UNSET:
            field_dict["span_id"] = span_id
        if type_ is not UNSET:
            field_dict["type"] = type_
        if is_guardrail is not UNSET:
            field_dict["is_guardrail"] = is_guardrail
        if evaluation_thread_id is not UNSET:
            field_dict["evaluation_thread_id"] = evaluation_thread_id
        if passed is not UNSET:
            field_dict["passed"] = passed
        if score is not UNSET:
            field_dict["score"] = score
        if label is not UNSET:
            field_dict["label"] = label
        if details is not UNSET:
            field_dict["details"] = details
        if inputs is not UNSET:
            field_dict["inputs"] = inputs
        if error is not UNSET:
            field_dict["error"] = error
        if retries is not UNSET:
            field_dict["retries"] = retries

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.evaluation_error_type_0 import EvaluationErrorType0
        from ..models.evaluation_inputs_type_0 import EvaluationInputsType0
        from ..models.evaluation_timestamps import EvaluationTimestamps

        d = dict(src_dict)
        evaluation_id = d.pop("evaluation_id")

        evaluator_id = d.pop("evaluator_id")

        name = d.pop("name")

        def _parse_status(
            data: object,
        ) -> (
            Literal["error"] | Literal["in_progress"] | Literal["processed"] | Literal["scheduled"] | Literal["skipped"]
        ):
            status_type_0 = cast(Literal["scheduled"], data)
            if status_type_0 != "scheduled":
                raise ValueError(f"status_type_0 must match const 'scheduled', got '{status_type_0}'")
            return status_type_0
            status_type_1 = cast(Literal["in_progress"], data)
            if status_type_1 != "in_progress":
                raise ValueError(f"status_type_1 must match const 'in_progress', got '{status_type_1}'")
            return status_type_1
            status_type_2 = cast(Literal["error"], data)
            if status_type_2 != "error":
                raise ValueError(f"status_type_2 must match const 'error', got '{status_type_2}'")
            return status_type_2
            status_type_3 = cast(Literal["skipped"], data)
            if status_type_3 != "skipped":
                raise ValueError(f"status_type_3 must match const 'skipped', got '{status_type_3}'")
            return status_type_3
            status_type_4 = cast(Literal["processed"], data)
            if status_type_4 != "processed":
                raise ValueError(f"status_type_4 must match const 'processed', got '{status_type_4}'")
            return status_type_4

        status = _parse_status(d.pop("status"))

        timestamps = EvaluationTimestamps.from_dict(d.pop("timestamps"))

        def _parse_span_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        span_id = _parse_span_id(d.pop("span_id", UNSET))

        def _parse_type_(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        type_ = _parse_type_(d.pop("type", UNSET))

        def _parse_is_guardrail(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        is_guardrail = _parse_is_guardrail(d.pop("is_guardrail", UNSET))

        def _parse_evaluation_thread_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        evaluation_thread_id = _parse_evaluation_thread_id(d.pop("evaluation_thread_id", UNSET))

        def _parse_passed(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        passed = _parse_passed(d.pop("passed", UNSET))

        def _parse_score(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        score = _parse_score(d.pop("score", UNSET))

        def _parse_label(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        label = _parse_label(d.pop("label", UNSET))

        def _parse_details(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        details = _parse_details(d.pop("details", UNSET))

        def _parse_inputs(data: object) -> EvaluationInputsType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                inputs_type_0 = EvaluationInputsType0.from_dict(data)

                return inputs_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(EvaluationInputsType0 | None | Unset, data)

        inputs = _parse_inputs(d.pop("inputs", UNSET))

        def _parse_error(data: object) -> EvaluationErrorType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = EvaluationErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(EvaluationErrorType0 | None | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        def _parse_retries(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        retries = _parse_retries(d.pop("retries", UNSET))

        evaluation = cls(
            evaluation_id=evaluation_id,
            evaluator_id=evaluator_id,
            name=name,
            status=status,
            timestamps=timestamps,
            span_id=span_id,
            type_=type_,
            is_guardrail=is_guardrail,
            evaluation_thread_id=evaluation_thread_id,
            passed=passed,
            score=score,
            label=label,
            details=details,
            inputs=inputs,
            error=error,
            retries=retries,
        )

        evaluation.additional_properties = d
        return evaluation

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
