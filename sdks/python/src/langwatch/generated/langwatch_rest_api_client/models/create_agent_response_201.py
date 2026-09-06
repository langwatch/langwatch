from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_response_201_status import CreateAgentResponse201Status
from ..models.create_agent_response_201_type import CreateAgentResponse201Type

if TYPE_CHECKING:
    from ..models.create_agent_response_201_config_type_0 import CreateAgentResponse201ConfigType0
    from ..models.create_agent_response_201_instances_item import CreateAgentResponse201InstancesItem
    from ..models.create_agent_response_201_owner_type_0 import CreateAgentResponse201OwnerType0
    from ..models.create_agent_response_201_parameters_item import CreateAgentResponse201ParametersItem


T = TypeVar("T", bound="CreateAgentResponse201")


@_attrs_define
class CreateAgentResponse201:
    """
    Attributes:
        id (str):
        name (str):
        type_ (CreateAgentResponse201Type): The kind of agent. A connected agent is registered from code by the SDK and
            cannot be created or reconfigured through this API.
        config (CreateAgentResponse201ConfigType0 | None):
        environment (None | str): The environment a connected agent registered with, for example production or
            development. Null for every other kind.
        owner_user_id (None | str): The user a personal development agent belongs to. Only that user can run simulations
            against it. Null when the agent is shared.
        host_label (None | str): The machine a development agent registered from with a project or service key. Null
            when the agent is personal or shared.
        last_seen_at (None | str): When an instance of a connected agent was last connected. Null for every other kind.
        parameters (list[CreateAgentResponse201ParametersItem]): The run parameters a connected agent declares from its
            function signature: name, type, options, default and description. Empty for every other kind.
        owner (CreateAgentResponse201OwnerType0 | None): The person a personal development agent belongs to. Null when
            the agent is shared or host-scoped.
        status (CreateAgentResponse201Status): online while at least one process running the connected agent is
            connected; offline otherwise, and always for every other kind.
        instances (list[CreateAgentResponse201InstancesItem]): The processes currently connected for a connected agent:
            hostname, user, pid, SDK and how many calls each has in flight. Empty for every other kind.
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    type_: CreateAgentResponse201Type
    config: CreateAgentResponse201ConfigType0 | None
    environment: None | str
    owner_user_id: None | str
    host_label: None | str
    last_seen_at: None | str
    parameters: list[CreateAgentResponse201ParametersItem]
    owner: CreateAgentResponse201OwnerType0 | None
    status: CreateAgentResponse201Status
    instances: list[CreateAgentResponse201InstancesItem]
    created_at: str
    updated_at: str
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.create_agent_response_201_config_type_0 import CreateAgentResponse201ConfigType0
        from ..models.create_agent_response_201_owner_type_0 import CreateAgentResponse201OwnerType0

        id = self.id

        name = self.name

        type_ = self.type_.value

        config: dict[str, Any] | None
        if isinstance(self.config, CreateAgentResponse201ConfigType0):
            config = self.config.to_dict()
        else:
            config = self.config

        environment: None | str
        environment = self.environment

        owner_user_id: None | str
        owner_user_id = self.owner_user_id

        host_label: None | str
        host_label = self.host_label

        last_seen_at: None | str
        last_seen_at = self.last_seen_at

        parameters = []
        for parameters_item_data in self.parameters:
            parameters_item = parameters_item_data.to_dict()
            parameters.append(parameters_item)

        owner: dict[str, Any] | None
        if isinstance(self.owner, CreateAgentResponse201OwnerType0):
            owner = self.owner.to_dict()
        else:
            owner = self.owner

        status = self.status.value

        instances = []
        for instances_item_data in self.instances:
            instances_item = instances_item_data.to_dict()
            instances.append(instances_item)

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "type": type_,
                "config": config,
                "environment": environment,
                "ownerUserId": owner_user_id,
                "hostLabel": host_label,
                "lastSeenAt": last_seen_at,
                "parameters": parameters,
                "owner": owner,
                "status": status,
                "instances": instances,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_response_201_config_type_0 import CreateAgentResponse201ConfigType0
        from ..models.create_agent_response_201_instances_item import CreateAgentResponse201InstancesItem
        from ..models.create_agent_response_201_owner_type_0 import CreateAgentResponse201OwnerType0
        from ..models.create_agent_response_201_parameters_item import CreateAgentResponse201ParametersItem

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        type_ = CreateAgentResponse201Type(d.pop("type"))

        def _parse_config(data: object) -> CreateAgentResponse201ConfigType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                config_type_0 = CreateAgentResponse201ConfigType0.from_dict(data)

                return config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(CreateAgentResponse201ConfigType0 | None, data)

        config = _parse_config(d.pop("config"))

        def _parse_environment(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment = _parse_environment(d.pop("environment"))

        def _parse_owner_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        owner_user_id = _parse_owner_user_id(d.pop("ownerUserId"))

        def _parse_host_label(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        host_label = _parse_host_label(d.pop("hostLabel"))

        def _parse_last_seen_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_seen_at = _parse_last_seen_at(d.pop("lastSeenAt"))

        parameters = []
        _parameters = d.pop("parameters")
        for parameters_item_data in _parameters:
            parameters_item = CreateAgentResponse201ParametersItem.from_dict(parameters_item_data)

            parameters.append(parameters_item)

        def _parse_owner(data: object) -> CreateAgentResponse201OwnerType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                owner_type_0 = CreateAgentResponse201OwnerType0.from_dict(data)

                return owner_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(CreateAgentResponse201OwnerType0 | None, data)

        owner = _parse_owner(d.pop("owner"))

        status = CreateAgentResponse201Status(d.pop("status"))

        instances = []
        _instances = d.pop("instances")
        for instances_item_data in _instances:
            instances_item = CreateAgentResponse201InstancesItem.from_dict(instances_item_data)

            instances.append(instances_item)

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        create_agent_response_201 = cls(
            id=id,
            name=name,
            type_=type_,
            config=config,
            environment=environment,
            owner_user_id=owner_user_id,
            host_label=host_label,
            last_seen_at=last_seen_at,
            parameters=parameters,
            owner=owner,
            status=status,
            instances=instances,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        create_agent_response_201.additional_properties = d
        return create_agent_response_201

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
