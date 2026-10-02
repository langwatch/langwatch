from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_cache_rules_response_201_cache_rule import (
        PostApiGatewayV1CacheRulesResponse201CacheRule,
    )


T = TypeVar("T", bound="PostApiGatewayV1CacheRulesResponse201")


@_attrs_define
class PostApiGatewayV1CacheRulesResponse201:
    """
    Attributes:
        cache_rule (PostApiGatewayV1CacheRulesResponse201CacheRule):
    """

    cache_rule: PostApiGatewayV1CacheRulesResponse201CacheRule

    def to_dict(self) -> dict[str, Any]:
        cache_rule = self.cache_rule.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "cache_rule": cache_rule,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_cache_rules_response_201_cache_rule import (
            PostApiGatewayV1CacheRulesResponse201CacheRule,
        )

        d = dict(src_dict)
        cache_rule = PostApiGatewayV1CacheRulesResponse201CacheRule.from_dict(d.pop("cache_rule"))

        post_api_gateway_v1_cache_rules_response_201 = cls(
            cache_rule=cache_rule,
        )

        return post_api_gateway_v1_cache_rules_response_201
