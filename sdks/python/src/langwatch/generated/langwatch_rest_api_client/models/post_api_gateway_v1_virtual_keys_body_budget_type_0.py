from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_gateway_v1_virtual_keys_body_budget_type_0_on_breach import (
    PostApiGatewayV1VirtualKeysBodyBudgetType0OnBreach,
)
from ..models.post_api_gateway_v1_virtual_keys_body_budget_type_0_window import (
    PostApiGatewayV1VirtualKeysBodyBudgetType0Window,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGatewayV1VirtualKeysBodyBudgetType0")


@_attrs_define
class PostApiGatewayV1VirtualKeysBodyBudgetType0:
    """
    Attributes:
        limit_usd (float | str):
        window (PostApiGatewayV1VirtualKeysBodyBudgetType0Window):
        on_breach (PostApiGatewayV1VirtualKeysBodyBudgetType0OnBreach | Unset):
        name (str | Unset):
    """

    limit_usd: float | str
    window: PostApiGatewayV1VirtualKeysBodyBudgetType0Window
    on_breach: PostApiGatewayV1VirtualKeysBodyBudgetType0OnBreach | Unset = UNSET
    name: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        limit_usd: float | str
        limit_usd = self.limit_usd

        window = self.window.value

        on_breach: str | Unset = UNSET
        if not isinstance(self.on_breach, Unset):
            on_breach = self.on_breach.value

        name = self.name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "limit_usd": limit_usd,
                "window": window,
            }
        )
        if on_breach is not UNSET:
            field_dict["on_breach"] = on_breach
        if name is not UNSET:
            field_dict["name"] = name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_limit_usd(data: object) -> float | str:
            return cast(float | str, data)

        limit_usd = _parse_limit_usd(d.pop("limit_usd"))

        window = PostApiGatewayV1VirtualKeysBodyBudgetType0Window(d.pop("window"))

        _on_breach = d.pop("on_breach", UNSET)
        on_breach: PostApiGatewayV1VirtualKeysBodyBudgetType0OnBreach | Unset
        if isinstance(_on_breach, Unset):
            on_breach = UNSET
        else:
            on_breach = PostApiGatewayV1VirtualKeysBodyBudgetType0OnBreach(_on_breach)

        name = d.pop("name", UNSET)

        post_api_gateway_v1_virtual_keys_body_budget_type_0 = cls(
            limit_usd=limit_usd,
            window=window,
            on_breach=on_breach,
            name=name,
        )

        post_api_gateway_v1_virtual_keys_body_budget_type_0.additional_properties = d
        return post_api_gateway_v1_virtual_keys_body_budget_type_0

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
