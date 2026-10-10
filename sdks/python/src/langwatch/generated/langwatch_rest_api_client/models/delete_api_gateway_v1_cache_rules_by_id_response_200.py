from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.delete_api_gateway_v1_cache_rules_by_id_response_200_cache_rule import (
        DeleteApiGatewayV1CacheRulesByIdResponse200CacheRule,
    )


T = TypeVar("T", bound="DeleteApiGatewayV1CacheRulesByIdResponse200")


@_attrs_define
class DeleteApiGatewayV1CacheRulesByIdResponse200:
    """
    Attributes:
        cache_rule (DeleteApiGatewayV1CacheRulesByIdResponse200CacheRule):
    """

    cache_rule: DeleteApiGatewayV1CacheRulesByIdResponse200CacheRule

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
        from ..models.delete_api_gateway_v1_cache_rules_by_id_response_200_cache_rule import (
            DeleteApiGatewayV1CacheRulesByIdResponse200CacheRule,
        )

        d = dict(src_dict)
        cache_rule = DeleteApiGatewayV1CacheRulesByIdResponse200CacheRule.from_dict(d.pop("cache_rule"))

        delete_api_gateway_v1_cache_rules_by_id_response_200 = cls(
            cache_rule=cache_rule,
        )

        return delete_api_gateway_v1_cache_rules_by_id_response_200
