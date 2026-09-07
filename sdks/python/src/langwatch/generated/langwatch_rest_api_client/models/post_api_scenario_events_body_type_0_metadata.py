from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_0_metadata_agents_item import (
        PostApiScenarioEventsBodyType0MetadataAgentsItem,
    )
    from ..models.post_api_scenario_events_body_type_0_metadata_langwatch import (
        PostApiScenarioEventsBodyType0MetadataLangwatch,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType0Metadata")


@_attrs_define
class PostApiScenarioEventsBodyType0Metadata:
    """
    Attributes:
        name (str | Unset):
        description (str | Unset):
        note (str | Unset):
        agents (list[PostApiScenarioEventsBodyType0MetadataAgentsItem] | Unset):
        langwatch (PostApiScenarioEventsBodyType0MetadataLangwatch | Unset):
    """

    name: str | Unset = UNSET
    description: str | Unset = UNSET
    note: str | Unset = UNSET
    agents: list[PostApiScenarioEventsBodyType0MetadataAgentsItem] | Unset = UNSET
    langwatch: PostApiScenarioEventsBodyType0MetadataLangwatch | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        note = self.note

        agents: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.agents, Unset):
            agents = []
            for agents_item_data in self.agents:
                agents_item = agents_item_data.to_dict()
                agents.append(agents_item)

        langwatch: dict[str, Any] | Unset = UNSET
        if not isinstance(self.langwatch, Unset):
            langwatch = self.langwatch.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if note is not UNSET:
            field_dict["note"] = note
        if agents is not UNSET:
            field_dict["agents"] = agents
        if langwatch is not UNSET:
            field_dict["langwatch"] = langwatch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_0_metadata_agents_item import (
            PostApiScenarioEventsBodyType0MetadataAgentsItem,
        )
        from ..models.post_api_scenario_events_body_type_0_metadata_langwatch import (
            PostApiScenarioEventsBodyType0MetadataLangwatch,
        )

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        note = d.pop("note", UNSET)

        _agents = d.pop("agents", UNSET)
        agents: list[PostApiScenarioEventsBodyType0MetadataAgentsItem] | Unset = UNSET
        if _agents is not UNSET:
            agents = []
            for agents_item_data in _agents:
                agents_item = PostApiScenarioEventsBodyType0MetadataAgentsItem.from_dict(agents_item_data)

                agents.append(agents_item)

        _langwatch = d.pop("langwatch", UNSET)
        langwatch: PostApiScenarioEventsBodyType0MetadataLangwatch | Unset
        if isinstance(_langwatch, Unset):
            langwatch = UNSET
        else:
            langwatch = PostApiScenarioEventsBodyType0MetadataLangwatch.from_dict(_langwatch)

        post_api_scenario_events_body_type_0_metadata = cls(
            name=name,
            description=description,
            note=note,
            agents=agents,
            langwatch=langwatch,
        )

        post_api_scenario_events_body_type_0_metadata.additional_properties = d
        return post_api_scenario_events_body_type_0_metadata

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
