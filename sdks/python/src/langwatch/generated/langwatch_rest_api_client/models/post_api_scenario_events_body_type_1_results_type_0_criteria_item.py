from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_1_results_type_0_criteria_item_status import (
    PostApiScenarioEventsBodyType1ResultsType0CriteriaItemStatus,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType1ResultsType0CriteriaItem")


@_attrs_define
class PostApiScenarioEventsBodyType1ResultsType0CriteriaItem:
    """
    Attributes:
        criterion (str):
        status (PostApiScenarioEventsBodyType1ResultsType0CriteriaItemStatus):
        requirement (str | Unset):
        reasoning (str | Unset):  Default: ''.
    """

    criterion: str
    status: PostApiScenarioEventsBodyType1ResultsType0CriteriaItemStatus
    requirement: str | Unset = UNSET
    reasoning: str | Unset = ""
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        criterion = self.criterion

        status = self.status.value

        requirement = self.requirement

        reasoning = self.reasoning

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "criterion": criterion,
                "status": status,
            }
        )
        if requirement is not UNSET:
            field_dict["requirement"] = requirement
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        criterion = d.pop("criterion")

        status = PostApiScenarioEventsBodyType1ResultsType0CriteriaItemStatus(d.pop("status"))

        requirement = d.pop("requirement", UNSET)

        reasoning = d.pop("reasoning", UNSET)

        post_api_scenario_events_body_type_1_results_type_0_criteria_item = cls(
            criterion=criterion,
            status=status,
            requirement=requirement,
            reasoning=reasoning,
        )

        post_api_scenario_events_body_type_1_results_type_0_criteria_item.additional_properties = d
        return post_api_scenario_events_body_type_1_results_type_0_criteria_item

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
