from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_gateway_v1_virtual_keys_body_config_fallback_on_item import (
    PostApiGatewayV1VirtualKeysBodyConfigFallbackOnItem,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGatewayV1VirtualKeysBodyConfigFallback")


@_attrs_define
class PostApiGatewayV1VirtualKeysBodyConfigFallback:
    """
    Attributes:
        on (list[PostApiGatewayV1VirtualKeysBodyConfigFallbackOnItem] | Unset):
        timeout_ms (int | Unset):  Default: 30000.
        max_attempts (int | Unset):  Default: 3.
    """

    on: list[PostApiGatewayV1VirtualKeysBodyConfigFallbackOnItem] | Unset = UNSET
    timeout_ms: int | Unset = 30000
    max_attempts: int | Unset = 3
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        on: list[str] | Unset = UNSET
        if not isinstance(self.on, Unset):
            on = []
            for on_item_data in self.on:
                on_item = on_item_data.value
                on.append(on_item)

        timeout_ms = self.timeout_ms

        max_attempts = self.max_attempts

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if on is not UNSET:
            field_dict["on"] = on
        if timeout_ms is not UNSET:
            field_dict["timeoutMs"] = timeout_ms
        if max_attempts is not UNSET:
            field_dict["maxAttempts"] = max_attempts

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _on = d.pop("on", UNSET)
        on: list[PostApiGatewayV1VirtualKeysBodyConfigFallbackOnItem] | Unset = UNSET
        if _on is not UNSET:
            on = []
            for on_item_data in _on:
                on_item = PostApiGatewayV1VirtualKeysBodyConfigFallbackOnItem(on_item_data)

                on.append(on_item)

        timeout_ms = d.pop("timeoutMs", UNSET)

        max_attempts = d.pop("maxAttempts", UNSET)

        post_api_gateway_v1_virtual_keys_body_config_fallback = cls(
            on=on,
            timeout_ms=timeout_ms,
            max_attempts=max_attempts,
        )

        post_api_gateway_v1_virtual_keys_body_config_fallback.additional_properties = d
        return post_api_gateway_v1_virtual_keys_body_config_fallback

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
