from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_cache_mode import (
    PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiGatewayV1VirtualKeysByIdBodyConfigCache")


@_attrs_define
class PatchApiGatewayV1VirtualKeysByIdBodyConfigCache:
    """
    Attributes:
        mode (PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode | Unset):  Default:
            PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode.RESPECT.
        ttl_s (int | Unset):  Default: 3600.
    """

    mode: PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode | Unset = (
        PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode.RESPECT
    )
    ttl_s: int | Unset = 3600
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        mode: str | Unset = UNSET
        if not isinstance(self.mode, Unset):
            mode = self.mode.value

        ttl_s = self.ttl_s

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if mode is not UNSET:
            field_dict["mode"] = mode
        if ttl_s is not UNSET:
            field_dict["ttlS"] = ttl_s

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _mode = d.pop("mode", UNSET)
        mode: PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode | Unset
        if isinstance(_mode, Unset):
            mode = UNSET
        else:
            mode = PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode(_mode)

        ttl_s = d.pop("ttlS", UNSET)

        patch_api_gateway_v1_virtual_keys_by_id_body_config_cache = cls(
            mode=mode,
            ttl_s=ttl_s,
        )

        patch_api_gateway_v1_virtual_keys_by_id_body_config_cache.additional_properties = d
        return patch_api_gateway_v1_virtual_keys_by_id_body_config_cache

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
