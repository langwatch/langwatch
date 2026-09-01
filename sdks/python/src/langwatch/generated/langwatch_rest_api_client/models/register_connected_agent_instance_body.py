from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.register_connected_agent_instance_body_protocol import RegisterConnectedAgentInstanceBodyProtocol
from ..models.register_connected_agent_instance_body_type import RegisterConnectedAgentInstanceBodyType

if TYPE_CHECKING:
    from ..models.register_connected_agent_instance_body_agents_item import RegisterConnectedAgentInstanceBodyAgentsItem
    from ..models.register_connected_agent_instance_body_instance import RegisterConnectedAgentInstanceBodyInstance
    from ..models.register_connected_agent_instance_body_sdk import RegisterConnectedAgentInstanceBodySdk


T = TypeVar("T", bound="RegisterConnectedAgentInstanceBody")


@_attrs_define
class RegisterConnectedAgentInstanceBody:
    """
    Attributes:
        protocol (RegisterConnectedAgentInstanceBodyProtocol):
        type_ (RegisterConnectedAgentInstanceBodyType):
        sdk (RegisterConnectedAgentInstanceBodySdk):
        instance (RegisterConnectedAgentInstanceBodyInstance):
        agents (list[RegisterConnectedAgentInstanceBodyAgentsItem]):
    """

    protocol: RegisterConnectedAgentInstanceBodyProtocol
    type_: RegisterConnectedAgentInstanceBodyType
    sdk: RegisterConnectedAgentInstanceBodySdk
    instance: RegisterConnectedAgentInstanceBodyInstance
    agents: list[RegisterConnectedAgentInstanceBodyAgentsItem]

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol.value

        type_ = self.type_.value

        sdk = self.sdk.to_dict()

        instance = self.instance.to_dict()

        agents = []
        for agents_item_data in self.agents:
            agents_item = agents_item_data.to_dict()
            agents.append(agents_item)

        field_dict: dict[str, Any] = {}

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
        protocol = RegisterConnectedAgentInstanceBodyProtocol(d.pop("protocol"))

        type_ = RegisterConnectedAgentInstanceBodyType(d.pop("type"))

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

        return register_connected_agent_instance_body
