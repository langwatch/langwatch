from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_schema_response_200_entry import (
        GetApiGovernanceRegistrySchemaResponse200Entry,
    )
    from ..models.get_api_governance_registry_schema_response_200_event import (
        GetApiGovernanceRegistrySchemaResponse200Event,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistrySchemaResponse200")


@_attrs_define
class GetApiGovernanceRegistrySchemaResponse200:
    """
    Attributes:
        entry (GetApiGovernanceRegistrySchemaResponse200Entry):
        event (GetApiGovernanceRegistrySchemaResponse200Event):
    """

    entry: GetApiGovernanceRegistrySchemaResponse200Entry
    event: GetApiGovernanceRegistrySchemaResponse200Event

    def to_dict(self) -> dict[str, Any]:
        entry = self.entry.to_dict()

        event = self.event.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "entry": entry,
                "event": event,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_schema_response_200_entry import (
            GetApiGovernanceRegistrySchemaResponse200Entry,
        )
        from ..models.get_api_governance_registry_schema_response_200_event import (
            GetApiGovernanceRegistrySchemaResponse200Event,
        )

        d = dict(src_dict)
        entry = GetApiGovernanceRegistrySchemaResponse200Entry.from_dict(d.pop("entry"))

        event = GetApiGovernanceRegistrySchemaResponse200Event.from_dict(d.pop("event"))

        get_api_governance_registry_schema_response_200 = cls(
            entry=entry,
            event=event,
        )

        return get_api_governance_registry_schema_response_200
