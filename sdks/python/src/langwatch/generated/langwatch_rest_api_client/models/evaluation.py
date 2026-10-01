from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

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
        evaluation_id (str | Unset):
        evaluator_id (str | Unset):
        span_id (None | str | Unset):
        name (str | Unset):
        type_ (None | str | Unset):
        is_guardrail (bool | None | Unset):
        evaluation_thread_id (None | str | Unset):
        status (str | Unset):
        passed (bool | None | Unset):
        score (float | None | Unset):
        label (None | str | Unset):
        details (None | str | Unset):
        inputs (EvaluationInputsType0 | None | Unset):
        error (EvaluationErrorType0 | None | Unset):
        retries (float | None | Unset):
        timestamps (EvaluationTimestamps | Unset):
    """

    evaluation_id: str | Unset = UNSET
    evaluator_id: str | Unset = UNSET
    span_id: None | str | Unset = UNSET
    name: str | Unset = UNSET
    type_: None | str | Unset = UNSET
    is_guardrail: bool | None | Unset = UNSET
    evaluation_thread_id: None | str | Unset = UNSET
    status: str | Unset = UNSET
    passed: bool | None | Unset = UNSET
    score: float | None | Unset = UNSET
    label: None | str | Unset = UNSET
    details: None | str | Unset = UNSET
    inputs: EvaluationInputsType0 | None | Unset = UNSET
    error: EvaluationErrorType0 | None | Unset = UNSET
    retries: float | None | Unset = UNSET
    timestamps: EvaluationTimestamps | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.evaluation_error_type_0 import EvaluationErrorType0
        from ..models.evaluation_inputs_type_0 import EvaluationInputsType0

        evaluation_id = self.evaluation_id

        evaluator_id = self.evaluator_id

        span_id: None | str | Unset
        if isinstance(self.span_id, Unset):
            span_id = UNSET
        else:
            span_id = self.span_id

        name = self.name

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

        status = self.status

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

        timestamps: dict[str, Any] | Unset = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if evaluation_id is not UNSET:
            field_dict["evaluation_id"] = evaluation_id
        if evaluator_id is not UNSET:
            field_dict["evaluator_id"] = evaluator_id
        if span_id is not UNSET:
            field_dict["span_id"] = span_id
        if name is not UNSET:
            field_dict["name"] = name
        if type_ is not UNSET:
            field_dict["type"] = type_
        if is_guardrail is not UNSET:
            field_dict["is_guardrail"] = is_guardrail
        if evaluation_thread_id is not UNSET:
            field_dict["evaluation_thread_id"] = evaluation_thread_id
        if status is not UNSET:
            field_dict["status"] = status
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
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.evaluation_error_type_0 import EvaluationErrorType0
        from ..models.evaluation_inputs_type_0 import EvaluationInputsType0
        from ..models.evaluation_timestamps import EvaluationTimestamps

        d = dict(src_dict)
        evaluation_id = d.pop("evaluation_id", UNSET)

        evaluator_id = d.pop("evaluator_id", UNSET)

        def _parse_span_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        span_id = _parse_span_id(d.pop("span_id", UNSET))

        name = d.pop("name", UNSET)

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

        status = d.pop("status", UNSET)

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

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: EvaluationTimestamps | Unset
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = EvaluationTimestamps.from_dict(_timestamps)

        evaluation = cls(
            evaluation_id=evaluation_id,
            evaluator_id=evaluator_id,
            span_id=span_id,
            name=name,
            type_=type_,
            is_guardrail=is_guardrail,
            evaluation_thread_id=evaluation_thread_id,
            status=status,
            passed=passed,
            score=score,
            label=label,
            details=details,
            inputs=inputs,
            error=error,
            retries=retries,
            timestamps=timestamps,
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
