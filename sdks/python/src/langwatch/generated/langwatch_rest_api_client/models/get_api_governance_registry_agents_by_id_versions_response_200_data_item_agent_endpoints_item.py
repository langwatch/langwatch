from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_endpoints_item_kind import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItemKind,
)

T = TypeVar("T", bound="GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItem")


@_attrs_define
class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItem:
    """
    Attributes:
        kind (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItemKind):
        url (str):
        protocol (str):
    """

    kind: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItemKind
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
        kind = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgentEndpointsItemKind(d.pop("kind"))

        url = d.pop("url")

        protocol = d.pop("protocol")

        get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_endpoints_item = cls(
            kind=kind,
            url=url,
            protocol=protocol,
        )

        return get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent_endpoints_item
