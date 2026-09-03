from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_experiments_runs_by_run_id_results_response_200_evaluations_item_status import (
    GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemStatus,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_evaluations_item_inputs_type_0 import (
        GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItem")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItem:
    """
    Attributes:
        evaluator (str):
        status (GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemStatus):
        index (float):
        name (None | str | Unset):
        target_id (None | str | Unset):
        score (float | None | Unset):
        label (None | str | Unset):
        passed (bool | None | Unset):
        details (None | str | Unset):
        cost (float | None | Unset):
        duration (float | None | Unset):
        inputs (GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0 | None | Unset):
    """

    evaluator: str
    status: GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemStatus
    index: float
    name: None | str | Unset = UNSET
    target_id: None | str | Unset = UNSET
    score: float | None | Unset = UNSET
    label: None | str | Unset = UNSET
    passed: bool | None | Unset = UNSET
    details: None | str | Unset = UNSET
    cost: float | None | Unset = UNSET
    duration: float | None | Unset = UNSET
    inputs: GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0 | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_evaluations_item_inputs_type_0 import (
            GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0,
        )

        evaluator = self.evaluator

        status = self.status.value

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

        duration: float | None | Unset
        if isinstance(self.duration, Unset):
            duration = UNSET
        else:
            duration = self.duration

        inputs: dict[str, Any] | None | Unset
        if isinstance(self.inputs, Unset):
            inputs = UNSET
        elif isinstance(self.inputs, GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0):
            inputs = self.inputs.to_dict()
        else:
            inputs = self.inputs

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
            field_dict["targetId"] = target_id
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
        if duration is not UNSET:
            field_dict["duration"] = duration
        if inputs is not UNSET:
            field_dict["inputs"] = inputs

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_evaluations_item_inputs_type_0 import (
            GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0,
        )

        d = dict(src_dict)
        evaluator = d.pop("evaluator")

        status = GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemStatus(d.pop("status"))

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

        target_id = _parse_target_id(d.pop("targetId", UNSET))

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

        def _parse_duration(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        duration = _parse_duration(d.pop("duration", UNSET))

        def _parse_inputs(
            data: object,
        ) -> GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                inputs_type_0 = GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0.from_dict(data)

                return inputs_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItemInputsType0 | None | Unset, data)

        inputs = _parse_inputs(d.pop("inputs", UNSET))

        get_api_experiments_runs_by_run_id_results_response_200_evaluations_item = cls(
            evaluator=evaluator,
            status=status,
            index=index,
            name=name,
            target_id=target_id,
            score=score,
            label=label,
            passed=passed,
            details=details,
            cost=cost,
            duration=duration,
            inputs=inputs,
        )

        get_api_experiments_runs_by_run_id_results_response_200_evaluations_item.additional_properties = d
        return get_api_experiments_runs_by_run_id_results_response_200_evaluations_item

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
