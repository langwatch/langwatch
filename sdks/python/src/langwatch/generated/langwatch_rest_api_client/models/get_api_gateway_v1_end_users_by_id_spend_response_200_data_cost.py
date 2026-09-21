from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiGatewayV1EndUsersByIdSpendResponse200DataCost")


@_attrs_define
class GetApiGatewayV1EndUsersByIdSpendResponse200DataCost:
    """
    Attributes:
        total_usd (str): Display value. Decimal string, up to 9 fractional digits, trailing zeros trimmed, never
            exponent notation. Use nano_usd for arithmetic.
        nano_usd (int): Canonical integer cost, nano-USD. Rated as an integer and summed as one, so this is the figure
            to reconcile against.
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

        get_api_gateway_v1_end_users_by_id_spend_response_200_data_cost = cls(
            total_usd=total_usd,
            nano_usd=nano_usd,
        )

        get_api_gateway_v1_end_users_by_id_spend_response_200_data_cost.additional_properties = d
        return get_api_gateway_v1_end_users_by_id_spend_response_200_data_cost

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
