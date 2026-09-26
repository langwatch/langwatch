from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2:
    """
    Attributes:
        kind (Literal['host']):
        host_label (str):
    """

    kind: Literal["host"]
    host_label: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        host_label = self.host_label

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "hostLabel": host_label,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["host"], d.pop("kind"))
        if kind != "host":
            raise ValueError(f"kind must match const 'host', got '{kind}'")

        host_label = d.pop("hostLabel")

        register_connected_agent_instance_response_200_frame_agents_item_scope_type_2 = cls(
            kind=kind,
            host_label=host_label,
        )

        register_connected_agent_instance_response_200_frame_agents_item_scope_type_2.additional_properties = d
        return register_connected_agent_instance_response_200_frame_agents_item_scope_type_2

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
