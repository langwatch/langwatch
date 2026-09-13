from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.register_connected_agent_instance_response_200_frame_type_0_agents_item import (
        RegisterConnectedAgentInstanceResponse200FrameType0AgentsItem,
    )


T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200FrameType0")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200FrameType0:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['registered']):
        agents (list[RegisterConnectedAgentInstanceResponse200FrameType0AgentsItem]):
        heartbeat_interval_ms (int):
        instance_id (str):
    """

    protocol: Literal[1]
    type_: Literal["registered"]
    agents: list[RegisterConnectedAgentInstanceResponse200FrameType0AgentsItem]
    heartbeat_interval_ms: int
    instance_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        agents = []
        for agents_item_data in self.agents:
            agents_item = agents_item_data.to_dict()
            agents.append(agents_item)

        heartbeat_interval_ms = self.heartbeat_interval_ms

        instance_id = self.instance_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "agents": agents,
                "heartbeatIntervalMs": heartbeat_interval_ms,
                "instanceId": instance_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_connected_agent_instance_response_200_frame_type_0_agents_item import (
            RegisterConnectedAgentInstanceResponse200FrameType0AgentsItem,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["registered"], d.pop("type"))
        if type_ != "registered":
            raise ValueError(f"type must match const 'registered', got '{type_}'")

        agents = []
        _agents = d.pop("agents")
        for agents_item_data in _agents:
            agents_item = RegisterConnectedAgentInstanceResponse200FrameType0AgentsItem.from_dict(agents_item_data)

            agents.append(agents_item)

        heartbeat_interval_ms = d.pop("heartbeatIntervalMs")

        instance_id = d.pop("instanceId")

        register_connected_agent_instance_response_200_frame_type_0 = cls(
            protocol=protocol,
            type_=type_,
            agents=agents,
            heartbeat_interval_ms=heartbeat_interval_ms,
            instance_id=instance_id,
        )

        register_connected_agent_instance_response_200_frame_type_0.additional_properties = d
        return register_connected_agent_instance_response_200_frame_type_0

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
