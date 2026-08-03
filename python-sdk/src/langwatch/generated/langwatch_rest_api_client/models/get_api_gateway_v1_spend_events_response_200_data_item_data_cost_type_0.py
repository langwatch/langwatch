from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0")


@_attrs_define
class GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0:
    """
    Attributes:
        total_usd (str):
        nano_usd (int):
    """

    total_usd: str
    nano_usd: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        total_usd = self.total_usd

        nano_usd = self.nano_usd

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "total_usd": total_usd,
                "nano_usd": nano_usd,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        total_usd = d.pop("total_usd")

        nano_usd = d.pop("nano_usd")

        get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0 = cls(
            total_usd=total_usd,
            nano_usd=nano_usd,
        )

        get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0.additional_properties = d
        return get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0

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
