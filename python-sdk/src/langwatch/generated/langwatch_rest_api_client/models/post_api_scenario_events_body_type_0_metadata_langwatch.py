from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_0_metadata_langwatch_target_type import (
    PostApiScenarioEventsBodyType0MetadataLangwatchTargetType,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType0MetadataLangwatch")


@_attrs_define
class PostApiScenarioEventsBodyType0MetadataLangwatch:
    """
    Attributes:
        target_reference_id (str):
        target_type (PostApiScenarioEventsBodyType0MetadataLangwatchTargetType):
        simulation_suite_id (str | Unset):
    """

    target_reference_id: str
    target_type: PostApiScenarioEventsBodyType0MetadataLangwatchTargetType
    simulation_suite_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        target_reference_id = self.target_reference_id

        target_type = self.target_type.value

        simulation_suite_id = self.simulation_suite_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "targetReferenceId": target_reference_id,
                "targetType": target_type,
            }
        )
        if simulation_suite_id is not UNSET:
            field_dict["simulationSuiteId"] = simulation_suite_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        target_reference_id = d.pop("targetReferenceId")

        target_type = PostApiScenarioEventsBodyType0MetadataLangwatchTargetType(d.pop("targetType"))

        simulation_suite_id = d.pop("simulationSuiteId", UNSET)

        post_api_scenario_events_body_type_0_metadata_langwatch = cls(
            target_reference_id=target_reference_id,
            target_type=target_type,
            simulation_suite_id=simulation_suite_id,
        )

        post_api_scenario_events_body_type_0_metadata_langwatch.additional_properties = d
        return post_api_scenario_events_body_type_0_metadata_langwatch

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
