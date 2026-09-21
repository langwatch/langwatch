from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        cache_rule = self.cache_rule.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_gateway_v1_cache_rules_response_201.additional_properties = d
        return post_api_gateway_v1_cache_rules_response_201

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
