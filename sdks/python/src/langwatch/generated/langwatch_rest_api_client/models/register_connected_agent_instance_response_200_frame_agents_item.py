from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_0 import (
        RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0,
    )
    from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_1 import (
        RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1,
    )
    from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_2 import (
        RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2,
    )


T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200FrameAgentsItem")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200FrameAgentsItem:
    """
    Attributes:
        name (str):
        environment (str):
        id (str):
        url (str):
        parameter_notes (list[str]):
        scope (RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0 |
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1 |
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2):
    """

    name: str
    environment: str
    id: str
    url: str
    parameter_notes: list[str]
    scope: (
        RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0
        | RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1
        | RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2
    )
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_0 import (
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0,
        )
        from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_1 import (
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1,
        )

        name = self.name

        environment = self.environment

        id = self.id

        url = self.url

        parameter_notes = self.parameter_notes

        scope: dict[str, Any]
        if isinstance(self.scope, RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1):
            scope = self.scope.to_dict()
        else:
            scope = self.scope.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "environment": environment,
                "id": id,
                "url": url,
                "parameterNotes": parameter_notes,
                "scope": scope,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_0 import (
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0,
        )
        from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_1 import (
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1,
        )
        from ..models.register_connected_agent_instance_response_200_frame_agents_item_scope_type_2 import (
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2,
        )

        d = dict(src_dict)
        name = d.pop("name")

        environment = d.pop("environment")

        id = d.pop("id")

        url = d.pop("url")

        parameter_notes = cast(list[str], d.pop("parameterNotes"))

        def _parse_scope(
            data: object,
        ) -> (
            RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0
            | RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1
            | RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            scope_type_2 = RegisterConnectedAgentInstanceResponse200FrameAgentsItemScopeType2.from_dict(data)

            return scope_type_2

        scope = _parse_scope(d.pop("scope"))

        register_connected_agent_instance_response_200_frame_agents_item = cls(
            name=name,
            environment=environment,
            id=id,
            url=url,
            parameter_notes=parameter_notes,
            scope=scope,
        )

        register_connected_agent_instance_response_200_frame_agents_item.additional_properties = d
        return register_connected_agent_instance_response_200_frame_agents_item

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
