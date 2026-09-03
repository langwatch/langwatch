from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiAgentCacheByNameClaimResponse200")


@_attrs_define
class PostApiAgentCacheByNameClaimResponse200:
    """
    Attributes:
        name (str):
        claimed (bool):
        ttl_seconds (float):
    """

    name: str
    claimed: bool
    ttl_seconds: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        claimed = self.claimed

        ttl_seconds = self.ttl_seconds

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "claimed": claimed,
                "ttl_seconds": ttl_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        claimed = d.pop("claimed")

        ttl_seconds = d.pop("ttl_seconds")

        post_api_agent_cache_by_name_claim_response_200 = cls(
            name=name,
            claimed=claimed,
            ttl_seconds=ttl_seconds,
        )

        post_api_agent_cache_by_name_claim_response_200.additional_properties = d
        return post_api_agent_cache_by_name_claim_response_200

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
