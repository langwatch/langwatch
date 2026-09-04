from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.register_connected_agent_instance_body_agents_item_parameters import (
        RegisterConnectedAgentInstanceBodyAgentsItemParameters,
    )


T = TypeVar("T", bound="RegisterConnectedAgentInstanceBodyAgentsItem")


@_attrs_define
class RegisterConnectedAgentInstanceBodyAgentsItem:
    """
    Attributes:
        name (str):
        environment (str):
        description (str | Unset):
        parameters (RegisterConnectedAgentInstanceBodyAgentsItemParameters | Unset):
        concurrency (int | Unset):
        timeout_ms (int | Unset):
        sticky (bool | Unset):
    """

    name: str
    environment: str
    description: str | Unset = UNSET
    parameters: RegisterConnectedAgentInstanceBodyAgentsItemParameters | Unset = UNSET
    concurrency: int | Unset = UNSET
    timeout_ms: int | Unset = UNSET
    sticky: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        environment = self.environment

        description = self.description

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        concurrency = self.concurrency

        timeout_ms = self.timeout_ms

        sticky = self.sticky

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "environment": environment,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if concurrency is not UNSET:
            field_dict["concurrency"] = concurrency
        if timeout_ms is not UNSET:
            field_dict["timeoutMs"] = timeout_ms
        if sticky is not UNSET:
            field_dict["sticky"] = sticky

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_connected_agent_instance_body_agents_item_parameters import (
            RegisterConnectedAgentInstanceBodyAgentsItemParameters,
        )

        d = dict(src_dict)
        name = d.pop("name")

        environment = d.pop("environment")

        description = d.pop("description", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: RegisterConnectedAgentInstanceBodyAgentsItemParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = RegisterConnectedAgentInstanceBodyAgentsItemParameters.from_dict(_parameters)

        concurrency = d.pop("concurrency", UNSET)

        timeout_ms = d.pop("timeoutMs", UNSET)

        sticky = d.pop("sticky", UNSET)

        register_connected_agent_instance_body_agents_item = cls(
            name=name,
            environment=environment,
            description=description,
            parameters=parameters,
            concurrency=concurrency,
            timeout_ms=timeout_ms,
            sticky=sticky,
        )

        return register_connected_agent_instance_body_agents_item
