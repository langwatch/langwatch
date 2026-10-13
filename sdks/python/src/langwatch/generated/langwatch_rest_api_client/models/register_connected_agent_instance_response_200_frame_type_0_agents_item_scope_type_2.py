from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200FrameType0AgentsItemScopeType2")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200FrameType0AgentsItemScopeType2:
    """
    Attributes:
        kind (Literal['host']):
        host_label (str):
    """

    kind: Literal["host"]
    host_label: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        host_label = self.host_label

        field_dict: dict[str, Any] = {}

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

        register_connected_agent_instance_response_200_frame_type_0_agents_item_scope_type_2 = cls(
            kind=kind,
            host_label=host_label,
        )

        return register_connected_agent_instance_response_200_frame_type_0_agents_item_scope_type_2
