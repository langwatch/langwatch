from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_management import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentManagement,
)
from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_posture import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentPosture,
)
from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_source import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentSource,
)
from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_status import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentStatus,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_endpoints_item import (
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItem,
    )
    from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_labels import (
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentLabels,
    )
    from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_model_type_0 import (
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0,
    )
    from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_owner_type_0 import (
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0,
    )
    from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_tools_item import (
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentToolsItem,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgent")


@_attrs_define
class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgent:
    """
    Attributes:
        id (str):
        source (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentSource):
        management (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentManagement):
        kind (str):
        name (str):
        description (None | str):
        status (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentStatus):
        shadow (bool):
        version (int):
        source_version (None | str):
        project_id (None | str):
        environment (None | str):
        owner (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0 | None):
        endpoints (list[GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItem]):
        model (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0 | None):
        instructions (None | str):
        capabilities (list[str]):
        tools (list[GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentToolsItem]):
        first_seen_at (str):
        last_seen_at (None | str):
        updated_at (str):
        removed_at (None | str):
        dormant (bool | Unset):
        posture (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentPosture | Unset):
        platform (None | str | Unset):
        labels (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentLabels | Unset):
        owner_label (None | str | Unset):
    """

    id: str
    source: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentSource
    management: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentManagement
    kind: str
    name: str
    description: None | str
    status: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentStatus
    shadow: bool
    version: int
    source_version: None | str
    project_id: None | str
    environment: None | str
    owner: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0 | None
    endpoints: list[GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItem]
    model: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0 | None
    instructions: None | str
    capabilities: list[str]
    tools: list[GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentToolsItem]
    first_seen_at: str
    last_seen_at: None | str
    updated_at: str
    removed_at: None | str
    dormant: bool | Unset = UNSET
    posture: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentPosture | Unset = UNSET
    platform: None | str | Unset = UNSET
    labels: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentLabels | Unset = UNSET
    owner_label: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_model_type_0 import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0,
        )
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_owner_type_0 import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0,
        )

        id = self.id

        source = self.source.value

        management = self.management.value

        kind = self.kind

        name = self.name

        description: None | str
        description = self.description

        status = self.status.value

        shadow = self.shadow

        version = self.version

        source_version: None | str
        source_version = self.source_version

        project_id: None | str
        project_id = self.project_id

        environment: None | str
        environment = self.environment

        owner: dict[str, Any] | None
        if isinstance(self.owner, GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0):
            owner = self.owner.to_dict()
        else:
            owner = self.owner

        endpoints = []
        for endpoints_item_data in self.endpoints:
            endpoints_item = endpoints_item_data.to_dict()
            endpoints.append(endpoints_item)

        model: dict[str, Any] | None
        if isinstance(self.model, GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0):
            model = self.model.to_dict()
        else:
            model = self.model

        instructions: None | str
        instructions = self.instructions

        capabilities = self.capabilities

        tools = []
        for tools_item_data in self.tools:
            tools_item = tools_item_data.to_dict()
            tools.append(tools_item)

        first_seen_at = self.first_seen_at

        last_seen_at: None | str
        last_seen_at = self.last_seen_at

        updated_at = self.updated_at

        removed_at: None | str
        removed_at = self.removed_at

        dormant = self.dormant

        posture: str | Unset = UNSET
        if not isinstance(self.posture, Unset):
            posture = self.posture.value

        platform: None | str | Unset
        if isinstance(self.platform, Unset):
            platform = UNSET
        else:
            platform = self.platform

        labels: dict[str, Any] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels.to_dict()

        owner_label: None | str | Unset
        if isinstance(self.owner_label, Unset):
            owner_label = UNSET
        else:
            owner_label = self.owner_label

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "source": source,
                "management": management,
                "kind": kind,
                "name": name,
                "description": description,
                "status": status,
                "shadow": shadow,
                "version": version,
                "source_version": source_version,
                "project_id": project_id,
                "environment": environment,
                "owner": owner,
                "endpoints": endpoints,
                "model": model,
                "instructions": instructions,
                "capabilities": capabilities,
                "tools": tools,
                "first_seen_at": first_seen_at,
                "last_seen_at": last_seen_at,
                "updated_at": updated_at,
                "removed_at": removed_at,
            }
        )
        if dormant is not UNSET:
            field_dict["dormant"] = dormant
        if posture is not UNSET:
            field_dict["posture"] = posture
        if platform is not UNSET:
            field_dict["platform"] = platform
        if labels is not UNSET:
            field_dict["labels"] = labels
        if owner_label is not UNSET:
            field_dict["owner_label"] = owner_label

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_endpoints_item import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItem,
        )
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_labels import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentLabels,
        )
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_model_type_0 import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0,
        )
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_owner_type_0 import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0,
        )
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_tools_item import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentToolsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        source = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentSource(d.pop("source"))

        management = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentManagement(d.pop("management"))

        kind = d.pop("kind")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        status = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentStatus(d.pop("status"))

        shadow = d.pop("shadow")

        version = d.pop("version")

        def _parse_source_version(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        source_version = _parse_source_version(d.pop("source_version"))

        def _parse_project_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        project_id = _parse_project_id(d.pop("project_id"))

        def _parse_environment(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment = _parse_environment(d.pop("environment"))

        def _parse_owner(
            data: object,
        ) -> GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                owner_type_0 = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0.from_dict(
                    data
                )

                return owner_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentOwnerType0 | None, data)

        owner = _parse_owner(d.pop("owner"))

        endpoints = []
        _endpoints = d.pop("endpoints")
        for endpoints_item_data in _endpoints:
            endpoints_item = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItem.from_dict(
                endpoints_item_data
            )

            endpoints.append(endpoints_item)

        def _parse_model(
            data: object,
        ) -> GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                model_type_0 = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0.from_dict(
                    data
                )

                return model_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentModelType0 | None, data)

        model = _parse_model(d.pop("model"))

        def _parse_instructions(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        instructions = _parse_instructions(d.pop("instructions"))

        capabilities = cast(list[str], d.pop("capabilities"))

        tools = []
        _tools = d.pop("tools")
        for tools_item_data in _tools:
            tools_item = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentToolsItem.from_dict(
                tools_item_data
            )

            tools.append(tools_item)

        first_seen_at = d.pop("first_seen_at")

        def _parse_last_seen_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_seen_at = _parse_last_seen_at(d.pop("last_seen_at"))

        updated_at = d.pop("updated_at")

        def _parse_removed_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        removed_at = _parse_removed_at(d.pop("removed_at"))

        dormant = d.pop("dormant", UNSET)

        _posture = d.pop("posture", UNSET)
        posture: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentPosture | Unset
        if isinstance(_posture, Unset):
            posture = UNSET
        else:
            posture = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentPosture(_posture)

        def _parse_platform(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        platform = _parse_platform(d.pop("platform", UNSET))

        _labels = d.pop("labels", UNSET)
        labels: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentLabels | Unset
        if isinstance(_labels, Unset):
            labels = UNSET
        else:
            labels = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentLabels.from_dict(_labels)

        def _parse_owner_label(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        owner_label = _parse_owner_label(d.pop("owner_label", UNSET))

        get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent = cls(
            id=id,
            source=source,
            management=management,
            kind=kind,
            name=name,
            description=description,
            status=status,
            shadow=shadow,
            version=version,
            source_version=source_version,
            project_id=project_id,
            environment=environment,
            owner=owner,
            endpoints=endpoints,
            model=model,
            instructions=instructions,
            capabilities=capabilities,
            tools=tools,
            first_seen_at=first_seen_at,
            last_seen_at=last_seen_at,
            updated_at=updated_at,
            removed_at=removed_at,
            dormant=dormant,
            posture=posture,
            platform=platform,
            labels=labels,
            owner_label=owner_label,
        )

        return get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent
