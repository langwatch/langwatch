from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item import (
        GetApiGovernanceRegistryArdManifestResponse200EntriesItem,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryArdManifestResponse200")


@_attrs_define
class GetApiGovernanceRegistryArdManifestResponse200:
    """
    Attributes:
        spec_version (Literal['0.91']):
        publisher (str):
        updated_at (str):
        entries (list[GetApiGovernanceRegistryArdManifestResponse200EntriesItem]):
    """

    spec_version: Literal["0.91"]
    publisher: str
    updated_at: str
    entries: list[GetApiGovernanceRegistryArdManifestResponse200EntriesItem]

    def to_dict(self) -> dict[str, Any]:
        spec_version = self.spec_version

        publisher = self.publisher

        updated_at = self.updated_at

        entries = []
        for entries_item_data in self.entries:
            entries_item = entries_item_data.to_dict()
            entries.append(entries_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "specVersion": spec_version,
                "publisher": publisher,
                "updatedAt": updated_at,
                "entries": entries,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_ard_manifest_response_200_entries_item import (
            GetApiGovernanceRegistryArdManifestResponse200EntriesItem,
        )

        d = dict(src_dict)
        spec_version = cast(Literal["0.91"], d.pop("specVersion"))
        if spec_version != "0.91":
            raise ValueError(f"specVersion must match const '0.91', got '{spec_version}'")

        publisher = d.pop("publisher")

        updated_at = d.pop("updatedAt")

        entries = []
        _entries = d.pop("entries")
        for entries_item_data in _entries:
            entries_item = GetApiGovernanceRegistryArdManifestResponse200EntriesItem.from_dict(entries_item_data)

            entries.append(entries_item)

        get_api_governance_registry_ard_manifest_response_200 = cls(
            spec_version=spec_version,
            publisher=publisher,
            updated_at=updated_at,
            entries=entries,
        )

        return get_api_governance_registry_ard_manifest_response_200
