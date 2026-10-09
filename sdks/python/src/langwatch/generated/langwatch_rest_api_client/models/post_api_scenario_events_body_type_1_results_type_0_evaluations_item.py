from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_1_results_type_0_evaluations_item_status import (
    PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemStatus,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_1_results_type_0_evaluations_item_cost import (
        PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemCost,
    )
    from ..models.post_api_scenario_events_body_type_1_results_type_0_evaluations_item_inputs import (
        PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemInputs,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem")


@_attrs_define
class PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem:
    """
    Attributes:
        evaluator_id (str):
        name (str):
        status (PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemStatus):
        required (bool):
        passed (bool | Unset):
        score (float | Unset):
        label (str | Unset):
        details (str | Unset):
        cost (PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemCost | Unset):
        inputs (PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemInputs | Unset):
    """

    evaluator_id: str
    name: str
    status: PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemStatus
    required: bool
    passed: bool | Unset = UNSET
    score: float | Unset = UNSET
    label: str | Unset = UNSET
    details: str | Unset = UNSET
    cost: PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemCost | Unset = UNSET
    inputs: PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemInputs | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        evaluator_id = self.evaluator_id

        name = self.name

        status = self.status.value

        required = self.required

        passed = self.passed

        score = self.score

        label = self.label

        details = self.details

        cost: dict[str, Any] | Unset = UNSET
        if not isinstance(self.cost, Unset):
            cost = self.cost.to_dict()

        inputs: dict[str, Any] | Unset = UNSET
        if not isinstance(self.inputs, Unset):
            inputs = self.inputs.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "evaluatorId": evaluator_id,
                "name": name,
                "status": status,
                "required": required,
            }
        )
        if passed is not UNSET:
            field_dict["passed"] = passed
        if score is not UNSET:
            field_dict["score"] = score
        if label is not UNSET:
            field_dict["label"] = label
        if details is not UNSET:
            field_dict["details"] = details
        if cost is not UNSET:
            field_dict["cost"] = cost
        if inputs is not UNSET:
            field_dict["inputs"] = inputs

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_1_results_type_0_evaluations_item_cost import (
            PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemCost,
        )
        from ..models.post_api_scenario_events_body_type_1_results_type_0_evaluations_item_inputs import (
            PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemInputs,
        )

        d = dict(src_dict)
        evaluator_id = d.pop("evaluatorId")

        name = d.pop("name")

        status = PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemStatus(d.pop("status"))

        required = d.pop("required")

        passed = d.pop("passed", UNSET)

        score = d.pop("score", UNSET)

        label = d.pop("label", UNSET)

        details = d.pop("details", UNSET)

        _cost = d.pop("cost", UNSET)
        cost: PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemCost | Unset
        if isinstance(_cost, Unset):
            cost = UNSET
        else:
            cost = PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemCost.from_dict(_cost)

        _inputs = d.pop("inputs", UNSET)
        inputs: PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemInputs | Unset
        if isinstance(_inputs, Unset):
            inputs = UNSET
        else:
            inputs = PostApiScenarioEventsBodyType1ResultsType0EvaluationsItemInputs.from_dict(_inputs)

        post_api_scenario_events_body_type_1_results_type_0_evaluations_item = cls(
            evaluator_id=evaluator_id,
            name=name,
            status=status,
            required=required,
            passed=passed,
            score=score,
            label=label,
            details=details,
            cost=cost,
            inputs=inputs,
        )

        post_api_scenario_events_body_type_1_results_type_0_evaluations_item.additional_properties = d
        return post_api_scenario_events_body_type_1_results_type_0_evaluations_item

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
