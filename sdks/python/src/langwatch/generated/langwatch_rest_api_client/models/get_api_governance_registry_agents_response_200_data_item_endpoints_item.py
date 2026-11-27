from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_governance_registry_agents_response_200_data_item_endpoints_item_kind import (
    GetApiGovernanceRegistryAgentsResponse200DataItemEndpointsItemKind,
)

T = TypeVar("T", bound="GetApiGovernanceRegistryAgentsResponse200DataItemEndpointsItem")


@_attrs_define
class GetApiGovernanceRegistryAgentsResponse200DataItemEndpointsItem:
    """
    Attributes:
        kind (GetApiGovernanceRegistryAgentsResponse200DataItemEndpointsItemKind):
        url (str):
        protocol (str):
    """

    kind: GetApiGovernanceRegistryAgentsResponse200DataItemEndpointsItemKind
    url: str
    protocol: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind.value

        url = self.url

        protocol = self.protocol

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "url": url,
                "protocol": protocol,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = GetApiGovernanceRegistryAgentsResponse200DataItemEndpointsItemKind(d.pop("kind"))

        url = d.pop("url")

        protocol = d.pop("protocol")

        get_api_governance_registry_agents_response_200_data_item_endpoints_item = cls(
            kind=kind,
            url=url,
            protocol=protocol,
        )

        return get_api_governance_registry_agents_response_200_data_item_endpoints_item
