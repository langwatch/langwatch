from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_batch_log_results_body_evaluations_item_inputs_type_0 import (
        PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0,
    )


T = TypeVar("T", bound="PostApiEvaluationsBatchLogResultsBodyEvaluationsItem")


@_attrs_define
class PostApiEvaluationsBatchLogResultsBodyEvaluationsItem:
    """
    Attributes:
        evaluator (str):
        status (Literal['error'] | Literal['processed'] | Literal['skipped']):
        index (float):
        name (None | str | Unset):
        target_id (None | str | Unset):
        duration (float | None | Unset):
        inputs (None | PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0 | Unset):
        score (float | None | Unset):
        label (None | str | Unset):
        passed (bool | None | Unset):
        details (None | str | Unset):
        cost (float | None | Unset):
    """

    evaluator: str
    status: Literal["error"] | Literal["processed"] | Literal["skipped"]
    index: float
    name: None | str | Unset = UNSET
    target_id: None | str | Unset = UNSET
    duration: float | None | Unset = UNSET
    inputs: None | PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0 | Unset = UNSET
    score: float | None | Unset = UNSET
    label: None | str | Unset = UNSET
    passed: bool | None | Unset = UNSET
    details: None | str | Unset = UNSET
    cost: float | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_evaluations_batch_log_results_body_evaluations_item_inputs_type_0 import (
            PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0,
        )

        evaluator = self.evaluator

        status: Literal["error"] | Literal["processed"] | Literal["skipped"]
        status = self.status

        index = self.index

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        target_id: None | str | Unset
        if isinstance(self.target_id, Unset):
            target_id = UNSET
        else:
            target_id = self.target_id

        duration: float | None | Unset
        if isinstance(self.duration, Unset):
            duration = UNSET
        else:
            duration = self.duration

        inputs: dict[str, Any] | None | Unset
        if isinstance(self.inputs, Unset):
            inputs = UNSET
        elif isinstance(self.inputs, PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0):
            inputs = self.inputs.to_dict()
        else:
            inputs = self.inputs

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

        passed: bool | None | Unset
        if isinstance(self.passed, Unset):
            passed = UNSET
        else:
            passed = self.passed

        details: None | str | Unset
        if isinstance(self.details, Unset):
            details = UNSET
        else:
            details = self.details

        cost: float | None | Unset
        if isinstance(self.cost, Unset):
            cost = UNSET
        else:
            cost = self.cost

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "evaluator": evaluator,
                "status": status,
                "index": index,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name
        if target_id is not UNSET:
            field_dict["target_id"] = target_id
        if duration is not UNSET:
            field_dict["duration"] = duration
        if inputs is not UNSET:
            field_dict["inputs"] = inputs
        if score is not UNSET:
            field_dict["score"] = score
        if label is not UNSET:
            field_dict["label"] = label
        if passed is not UNSET:
            field_dict["passed"] = passed
        if details is not UNSET:
            field_dict["details"] = details
        if cost is not UNSET:
            field_dict["cost"] = cost

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluations_batch_log_results_body_evaluations_item_inputs_type_0 import (
            PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0,
        )

        d = dict(src_dict)
        evaluator = d.pop("evaluator")

        def _parse_status(data: object) -> Literal["error"] | Literal["processed"] | Literal["skipped"]:
            status_type_0 = cast(Literal["processed"], data)
            if status_type_0 != "processed":
                raise ValueError(f"status_type_0 must match const 'processed', got '{status_type_0}'")
            return status_type_0
            status_type_1 = cast(Literal["skipped"], data)
            if status_type_1 != "skipped":
                raise ValueError(f"status_type_1 must match const 'skipped', got '{status_type_1}'")
            return status_type_1
            status_type_2 = cast(Literal["error"], data)
            if status_type_2 != "error":
                raise ValueError(f"status_type_2 must match const 'error', got '{status_type_2}'")
            return status_type_2

        status = _parse_status(d.pop("status"))

        index = d.pop("index")

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        def _parse_target_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        target_id = _parse_target_id(d.pop("target_id", UNSET))

        def _parse_duration(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        duration = _parse_duration(d.pop("duration", UNSET))

        def _parse_inputs(
            data: object,
        ) -> None | PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                inputs_type_0 = PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0.from_dict(data)

                return inputs_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiEvaluationsBatchLogResultsBodyEvaluationsItemInputsType0 | Unset, data)

        inputs = _parse_inputs(d.pop("inputs", UNSET))

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

        def _parse_passed(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        passed = _parse_passed(d.pop("passed", UNSET))

        def _parse_details(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        details = _parse_details(d.pop("details", UNSET))

        def _parse_cost(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cost = _parse_cost(d.pop("cost", UNSET))

        post_api_evaluations_batch_log_results_body_evaluations_item = cls(
            evaluator=evaluator,
            status=status,
            index=index,
            name=name,
            target_id=target_id,
            duration=duration,
            inputs=inputs,
            score=score,
            label=label,
            passed=passed,
            details=details,
            cost=cost,
        )

        post_api_evaluations_batch_log_results_body_evaluations_item.additional_properties = d
        return post_api_evaluations_batch_log_results_body_evaluations_item

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
