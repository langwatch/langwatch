from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiAgentCacheByNameClaimResponse200")


@_attrs_define
class PostApiAgentCacheByNameClaimResponse200:
    """
    Attributes:
        name (str):
        ttl_seconds (float):
        claimed (bool):
    """

    name: str
    ttl_seconds: float
    claimed: bool

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        ttl_seconds = self.ttl_seconds

        claimed = self.claimed

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "ttl_seconds": ttl_seconds,
                "claimed": claimed,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        ttl_seconds = d.pop("ttl_seconds")

        claimed = d.pop("claimed")

        post_api_agent_cache_by_name_claim_response_200 = cls(
            name=name,
            ttl_seconds=ttl_seconds,
            claimed=claimed,
        )

        return post_api_agent_cache_by_name_claim_response_200
