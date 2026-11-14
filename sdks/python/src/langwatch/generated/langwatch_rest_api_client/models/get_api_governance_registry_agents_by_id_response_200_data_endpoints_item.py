from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_governance_registry_agents_by_id_response_200_data_endpoints_item_kind import (
    GetApiGovernanceRegistryAgentsByIdResponse200DataEndpointsItemKind,
)

T = TypeVar("T", bound="GetApiGovernanceRegistryAgentsByIdResponse200DataEndpointsItem")


@_attrs_define
class GetApiGovernanceRegistryAgentsByIdResponse200DataEndpointsItem:
    """
    Attributes:
        kind (GetApiGovernanceRegistryAgentsByIdResponse200DataEndpointsItemKind):
        url (str):
        protocol (str):
    """

    kind: GetApiGovernanceRegistryAgentsByIdResponse200DataEndpointsItemKind
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
        kind = GetApiGovernanceRegistryAgentsByIdResponse200DataEndpointsItemKind(d.pop("kind"))

        url = d.pop("url")

        protocol = d.pop("protocol")

        get_api_governance_registry_agents_by_id_response_200_data_endpoints_item = cls(
            kind=kind,
            url=url,
            protocol=protocol,
        )

        return get_api_governance_registry_agents_by_id_response_200_data_endpoints_item
