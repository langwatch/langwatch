from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data import (
        GetApiGovernanceRegistryArdManifestResponse200EntriesItemData,
    )
    from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_metadata import (
        GetApiGovernanceRegistryArdManifestResponse200EntriesItemMetadata,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryArdManifestResponse200EntriesItem")


@_attrs_define
class GetApiGovernanceRegistryArdManifestResponse200EntriesItem:
    """
    Attributes:
        context (Literal['https://agenticresourcediscovery.org/context/v1']):
        identifier (str):
        display_name (str):
        type_ (Literal['application/agent-card+json']):
        version (str):
        updated_at (str):
        tags (list[str]):
        capabilities (list[str]):
        data (GetApiGovernanceRegistryArdManifestResponse200EntriesItemData):
        metadata (GetApiGovernanceRegistryArdManifestResponse200EntriesItemMetadata):
        description (str | Unset):
    """

    context: Literal["https://agenticresourcediscovery.org/context/v1"]
    identifier: str
    display_name: str
    type_: Literal["application/agent-card+json"]
    version: str
    updated_at: str
    tags: list[str]
    capabilities: list[str]
    data: GetApiGovernanceRegistryArdManifestResponse200EntriesItemData
    metadata: GetApiGovernanceRegistryArdManifestResponse200EntriesItemMetadata
    description: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        context = self.context

        identifier = self.identifier

        display_name = self.display_name

        type_ = self.type_

        version = self.version

        updated_at = self.updated_at

        tags = self.tags

        capabilities = self.capabilities

        data = self.data.to_dict()

        metadata = self.metadata.to_dict()

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "@context": context,
                "identifier": identifier,
                "displayName": display_name,
                "type": type_,
                "version": version,
                "updatedAt": updated_at,
                "tags": tags,
                "capabilities": capabilities,
                "data": data,
                "metadata": metadata,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_data import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemData,
        )
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item_metadata import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItemMetadata,
        )

        d = dict(src_dict)
        context = cast(Literal["https://agenticresourcediscovery.org/context/v1"], d.pop("@context"))
        if context != "https://agenticresourcediscovery.org/context/v1":
            raise ValueError(
                f"@context must match const 'https://agenticresourcediscovery.org/context/v1', got '{context}'"
            )

        identifier = d.pop("identifier")

        display_name = d.pop("displayName")

        type_ = cast(Literal["application/agent-card+json"], d.pop("type"))
        if type_ != "application/agent-card+json":
            raise ValueError(f"type must match const 'application/agent-card+json', got '{type_}'")

        version = d.pop("version")

        updated_at = d.pop("updatedAt")

        tags = cast(list[str], d.pop("tags"))

        capabilities = cast(list[str], d.pop("capabilities"))

        data = GetApiGovernanceRegistryArdManifestResponse200EntriesItemData.from_dict(d.pop("data"))

        metadata = GetApiGovernanceRegistryArdManifestResponse200EntriesItemMetadata.from_dict(d.pop("metadata"))

        description = d.pop("description", UNSET)

        get_api_governance_registry_ard_manifest_response_200_entries_item = cls(
            context=context,
            identifier=identifier,
            display_name=display_name,
            type_=type_,
            version=version,
            updated_at=updated_at,
            tags=tags,
            capabilities=capabilities,
            data=data,
            metadata=metadata,
            description=description,
        )

        return get_api_governance_registry_ard_manifest_response_200_entries_item
