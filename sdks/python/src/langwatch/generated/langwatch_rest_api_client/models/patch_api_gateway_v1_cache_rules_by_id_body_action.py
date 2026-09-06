from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.patch_api_gateway_v1_cache_rules_by_id_body_action_mode import (
    PatchApiGatewayV1CacheRulesByIdBodyActionMode,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiGatewayV1CacheRulesByIdBodyAction")


@_attrs_define
class PatchApiGatewayV1CacheRulesByIdBodyAction:
    """
    Attributes:
        mode (PatchApiGatewayV1CacheRulesByIdBodyActionMode):
        ttl (int | Unset):
        salt (str | Unset):
    """

    mode: PatchApiGatewayV1CacheRulesByIdBodyActionMode
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
        mode = PatchApiGatewayV1CacheRulesByIdBodyActionMode(d.pop("mode"))

        ttl = d.pop("ttl", UNSET)

        salt = d.pop("salt", UNSET)

        patch_api_gateway_v1_cache_rules_by_id_body_action = cls(
            mode=mode,
            ttl=ttl,
            salt=salt,
        )

        return patch_api_gateway_v1_cache_rules_by_id_body_action
