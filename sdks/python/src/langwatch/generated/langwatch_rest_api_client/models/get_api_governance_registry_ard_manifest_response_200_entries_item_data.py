from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_management import (
    GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataManagement,
)
from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_source import (
    GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataSource,
)
from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_status import (
    GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataStatus,
)

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_endpoints_item import (
        GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataEndpointsItem,
    )
    from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_model_type_0 import (
        GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0,
    )
    from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_owner_type_0 import (
        GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0,
    )
    from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_tools_item import (
        GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataToolsItem,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryArdManifestResponse200EntriesItemData")


@_attrs_define
class GetApiGovernanceRegistryArdManifestResponse200EntriesItemData:
    """
    Attributes:
        id (str):
        source (GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataSource):
        management (GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataManagement):
        kind (str):
        name (str):
        description (None | str):
        status (GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataStatus):
        shadow (bool):
        version (int):
        source_version (None | str):
        project_id (None | str):
        environment (None | str):
        owner (GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0 | None):
        endpoints (list[GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataEndpointsItem]):
        model (GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0 | None):
        instructions (None | str):
        capabilities (list[str]):
        tools (list[GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataToolsItem]):
        first_seen_at (str):
        last_seen_at (None | str):
        updated_at (str):
        removed_at (None | str):
    """

    id: str
    source: GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataSource
    management: GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataManagement
    kind: str
    name: str
    description: None | str
    status: GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataStatus
    shadow: bool
    version: int
    source_version: None | str
    project_id: None | str
    environment: None | str
    owner: GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0 | None
    endpoints: list[GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataEndpointsItem]
    model: GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0 | None
    instructions: None | str
    capabilities: list[str]
    tools: list[GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataToolsItem]
    first_seen_at: str
    last_seen_at: None | str
    updated_at: str
    removed_at: None | str

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_model_type_0 import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0,
        )
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_owner_type_0 import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0,
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
        if isinstance(self.owner, GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0):
            owner = self.owner.to_dict()
        else:
            owner = self.owner

        endpoints = []
        for endpoints_item_data in self.endpoints:
            endpoints_item = endpoints_item_data.to_dict()
            endpoints.append(endpoints_item)

        model: dict[str, Any] | None
        if isinstance(self.model, GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0):
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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_endpoints_item import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataEndpointsItem,
        )
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_model_type_0 import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0,
        )
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_owner_type_0 import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0,
        )
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data_tools_item import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataToolsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        source = GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataSource(d.pop("source"))

        management = GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataManagement(d.pop("management"))

        kind = d.pop("kind")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        status = GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataStatus(d.pop("status"))

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
        ) -> GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                owner_type_0 = GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0.from_dict(data)

                return owner_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataOwnerType0 | None, data)

        owner = _parse_owner(d.pop("owner"))

        endpoints = []
        _endpoints = d.pop("endpoints")
        for endpoints_item_data in _endpoints:
            endpoints_item = GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataEndpointsItem.from_dict(
                endpoints_item_data
            )

            endpoints.append(endpoints_item)

        def _parse_model(
            data: object,
        ) -> GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                model_type_0 = GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0.from_dict(data)

                return model_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataModelType0 | None, data)

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
            tools_item = GetApiGovernanceRegistryArdManifestResponse200EntriesItemDataToolsItem.from_dict(
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

        get_api_governance_registry_ard_manifest_response_200_entries_item_data = cls(
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
        )

        return get_api_governance_registry_ard_manifest_response_200_entries_item_data
