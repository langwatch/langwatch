from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200FrameType0AgentsItem")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200FrameType0AgentsItem:
    """
    Attributes:
        name (str):
        environment (str):
        id (str):
        url (str):
        parameter_notes (list[str]):
    """

    name: str
    environment: str
    id: str
    url: str
    parameter_notes: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        environment = self.environment

        id = self.id

        url = self.url

        parameter_notes = self.parameter_notes

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "environment": environment,
                "id": id,
                "url": url,
                "parameterNotes": parameter_notes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        environment = d.pop("environment")

        id = d.pop("id")

        url = d.pop("url")

        parameter_notes = cast(list[str], d.pop("parameterNotes"))

        register_connected_agent_instance_response_200_frame_type_0_agents_item = cls(
            name=name,
            environment=environment,
            id=id,
            url=url,
            parameter_notes=parameter_notes,
        )

        register_connected_agent_instance_response_200_frame_type_0_agents_item.additional_properties = d
        return register_connected_agent_instance_response_200_frame_type_0_agents_item

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
