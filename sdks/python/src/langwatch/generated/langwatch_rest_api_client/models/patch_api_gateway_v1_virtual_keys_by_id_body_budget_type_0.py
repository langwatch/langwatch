from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0_on_breach import (
    PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0OnBreach,
)
from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0_window import (
    PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0Window,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0")


@_attrs_define
class PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0:
    """
    Attributes:
        limit_usd (float | str):
        window (PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0Window):
        on_breach (PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0OnBreach | Unset):
        name (str | Unset):
    """

    limit_usd: float | str
    window: PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0Window
    on_breach: PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0OnBreach | Unset = UNSET
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

        window = PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0Window(d.pop("window"))

        _on_breach = d.pop("on_breach", UNSET)
        on_breach: PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0OnBreach | Unset
        if isinstance(_on_breach, Unset):
            on_breach = UNSET
        else:
            on_breach = PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0OnBreach(_on_breach)

        name = d.pop("name", UNSET)

        patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0 = cls(
            limit_usd=limit_usd,
            window=window,
            on_breach=on_breach,
            name=name,
        )

        patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0.additional_properties = d
        return patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0

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
