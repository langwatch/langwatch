from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_gateway_v1_cache_rules_body_action_mode import PostApiGatewayV1CacheRulesBodyActionMode
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGatewayV1CacheRulesBodyAction")


@_attrs_define
class PostApiGatewayV1CacheRulesBodyAction:
    """
    Attributes:
        mode (PostApiGatewayV1CacheRulesBodyActionMode):
        ttl (int | Unset):
        salt (str | Unset):
    """

    mode: PostApiGatewayV1CacheRulesBodyActionMode
    ttl: int | Unset = UNSET
    salt: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode.value

        ttl = self.ttl

        salt = self.salt

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "mode": mode,
            }
        )
        if ttl is not UNSET:
            field_dict["ttl"] = ttl
        if salt is not UNSET:
            field_dict["salt"] = salt

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mode = PostApiGatewayV1CacheRulesBodyActionMode(d.pop("mode"))

        ttl = d.pop("ttl", UNSET)

        salt = d.pop("salt", UNSET)

        post_api_gateway_v1_cache_rules_body_action = cls(
            mode=mode,
            ttl=ttl,
            salt=salt,
        )

        return post_api_gateway_v1_cache_rules_body_action
