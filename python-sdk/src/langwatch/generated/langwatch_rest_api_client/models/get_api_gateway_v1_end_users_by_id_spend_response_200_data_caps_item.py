from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data_caps_item_on_breach import (
    GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItemOnBreach,
)

T = TypeVar("T", bound="GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItem")


@_attrs_define
class GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItem:
    """
    Attributes:
        budget_id (str):
        anchor_id (str):
        window (str):
        on_breach (GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItemOnBreach):
        limit_usd (str):
        spent_usd (str):
        period_started_at (str):
    """

    budget_id: str
    anchor_id: str
    window: str
    on_breach: GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItemOnBreach
    limit_usd: str
    spent_usd: str
    period_started_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        budget_id = self.budget_id

        anchor_id = self.anchor_id

        window = self.window

        on_breach = self.on_breach.value

        limit_usd = self.limit_usd

        spent_usd = self.spent_usd

        period_started_at = self.period_started_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "budget_id": budget_id,
                "anchor_id": anchor_id,
                "window": window,
                "on_breach": on_breach,
                "limit_usd": limit_usd,
                "spent_usd": spent_usd,
                "period_started_at": period_started_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        budget_id = d.pop("budget_id")

        anchor_id = d.pop("anchor_id")

        window = d.pop("window")

        on_breach = GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItemOnBreach(d.pop("on_breach"))

        limit_usd = d.pop("limit_usd")

        spent_usd = d.pop("spent_usd")

        period_started_at = d.pop("period_started_at")

        get_api_gateway_v1_end_users_by_id_spend_response_200_data_caps_item = cls(
            budget_id=budget_id,
            anchor_id=anchor_id,
            window=window,
            on_breach=on_breach,
            limit_usd=limit_usd,
            spent_usd=spent_usd,
            period_started_at=period_started_at,
        )

        get_api_gateway_v1_end_users_by_id_spend_response_200_data_caps_item.additional_properties = d
        return get_api_gateway_v1_end_users_by_id_spend_response_200_data_caps_item

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
