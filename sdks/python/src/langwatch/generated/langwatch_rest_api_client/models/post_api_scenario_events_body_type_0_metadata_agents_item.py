from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_0_metadata_agents_item_role import (
    PostApiScenarioEventsBodyType0MetadataAgentsItemRole,
)

T = TypeVar("T", bound="PostApiScenarioEventsBodyType0MetadataAgentsItem")


@_attrs_define
class PostApiScenarioEventsBodyType0MetadataAgentsItem:
    """
    Attributes:
        name (str):
        role (PostApiScenarioEventsBodyType0MetadataAgentsItemRole):
    """

    name: str
    role: PostApiScenarioEventsBodyType0MetadataAgentsItemRole
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        role = self.role.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "role": role,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        role = PostApiScenarioEventsBodyType0MetadataAgentsItemRole(d.pop("role"))

        post_api_scenario_events_body_type_0_metadata_agents_item = cls(
            name=name,
            role=role,
        )

        post_api_scenario_events_body_type_0_metadata_agents_item.additional_properties = d
        return post_api_scenario_events_body_type_0_metadata_agents_item

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
