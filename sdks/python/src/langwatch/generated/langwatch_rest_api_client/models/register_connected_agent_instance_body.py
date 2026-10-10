from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.register_connected_agent_instance_body_agents_item import RegisterConnectedAgentInstanceBodyAgentsItem
    from ..models.register_connected_agent_instance_body_instance import RegisterConnectedAgentInstanceBodyInstance
    from ..models.register_connected_agent_instance_body_sdk import RegisterConnectedAgentInstanceBodySdk


T = TypeVar("T", bound="RegisterConnectedAgentInstanceBody")


@_attrs_define
class RegisterConnectedAgentInstanceBody:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['register']):
        sdk (RegisterConnectedAgentInstanceBodySdk):
        instance (RegisterConnectedAgentInstanceBodyInstance):
        agents (list[RegisterConnectedAgentInstanceBodyAgentsItem]):
    """

    protocol: Literal[1]
    type_: Literal["register"]
    sdk: RegisterConnectedAgentInstanceBodySdk
    instance: RegisterConnectedAgentInstanceBodyInstance
    agents: list[RegisterConnectedAgentInstanceBodyAgentsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        sdk = self.sdk.to_dict()

        instance = self.instance.to_dict()

        agents = []
        for agents_item_data in self.agents:
            agents_item = agents_item_data.to_dict()
            agents.append(agents_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "sdk": sdk,
                "instance": instance,
                "agents": agents,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_connected_agent_instance_body_agents_item import (
            RegisterConnectedAgentInstanceBodyAgentsItem,
        )
        from ..models.register_connected_agent_instance_body_instance import RegisterConnectedAgentInstanceBodyInstance
        from ..models.register_connected_agent_instance_body_sdk import RegisterConnectedAgentInstanceBodySdk

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["register"], d.pop("type"))
        if type_ != "register":
            raise ValueError(f"type must match const 'register', got '{type_}'")

        sdk = RegisterConnectedAgentInstanceBodySdk.from_dict(d.pop("sdk"))

        instance = RegisterConnectedAgentInstanceBodyInstance.from_dict(d.pop("instance"))

        agents = []
        _agents = d.pop("agents")
        for agents_item_data in _agents:
            agents_item = RegisterConnectedAgentInstanceBodyAgentsItem.from_dict(agents_item_data)

            agents.append(agents_item)

        register_connected_agent_instance_body = cls(
            protocol=protocol,
            type_=type_,
            sdk=sdk,
            instance=instance,
            agents=agents,
        )

        register_connected_agent_instance_body.additional_properties = d
        return register_connected_agent_instance_body

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
