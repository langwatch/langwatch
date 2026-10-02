from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200FrameType0AgentsItemScopeType0")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200FrameType0AgentsItemScopeType0:
    """
    Attributes:
        kind (Literal['shared']):
    """

    kind: Literal["shared"]

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["shared"], d.pop("kind"))
        if kind != "shared":
            raise ValueError(f"kind must match const 'shared', got '{kind}'")

        register_connected_agent_instance_response_200_frame_type_0_agents_item_scope_type_0 = cls(
            kind=kind,
        )

        return register_connected_agent_instance_response_200_frame_type_0_agents_item_scope_type_0
