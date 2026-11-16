from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_endpoints_item_kind import (
    PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataEndpointsItemKind,
)

T = TypeVar("T", bound="PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataEndpointsItem")


@_attrs_define
class PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataEndpointsItem:
    """
    Attributes:
        kind (PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataEndpointsItemKind):
        url (str):
        protocol (str):
    """

    kind: PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataEndpointsItemKind
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
        kind = PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataEndpointsItemKind(d.pop("kind"))

        url = d.pop("url")

        protocol = d.pop("protocol")

        post_api_governance_registry_ard_search_response_200_results_item_data_endpoints_item = cls(
            kind=kind,
            url=url,
            protocol=protocol,
        )

        return post_api_governance_registry_ard_search_response_200_results_item_data_endpoints_item
