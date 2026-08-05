from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_action_mode import (
    PatchApiGatewayV1CacheRulesByIdResponse200CacheRuleActionMode,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiGatewayV1CacheRulesByIdResponse200CacheRuleAction")


@_attrs_define
class PatchApiGatewayV1CacheRulesByIdResponse200CacheRuleAction:
    """
    Attributes:
        mode (PatchApiGatewayV1CacheRulesByIdResponse200CacheRuleActionMode):
        ttl (int | Unset):
        salt (str | Unset):
    """

    mode: PatchApiGatewayV1CacheRulesByIdResponse200CacheRuleActionMode
    ttl: int | Unset = UNSET
    salt: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode.value

        ttl = self.ttl

        salt = self.salt

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        mode = PatchApiGatewayV1CacheRulesByIdResponse200CacheRuleActionMode(d.pop("mode"))

        ttl = d.pop("ttl", UNSET)

        salt = d.pop("salt", UNSET)

        patch_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_action = cls(
            mode=mode,
            ttl=ttl,
            salt=salt,
        )

        patch_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_action.additional_properties = d
        return patch_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_action

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
