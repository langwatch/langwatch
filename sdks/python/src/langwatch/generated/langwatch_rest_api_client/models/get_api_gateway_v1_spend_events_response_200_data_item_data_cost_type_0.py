from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0")


@_attrs_define
class GetApiGatewayV1SpendEventsResponse200DataItemDataCostType0:
    """
    Attributes:
        total_usd (str): Display value. Use nano_usd for arithmetic.
        nano_usd (int): Canonical integer cost, nano-USD.
        rate_version (None | str | Unset):
    """

    total_usd: str
    nano_usd: int
    rate_version: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        total_usd = self.total_usd

        nano_usd = self.nano_usd

        rate_version: None | str | Unset
        if isinstance(self.rate_version, Unset):
            rate_version = UNSET
        else:
            rate_version = self.rate_version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "total_usd": total_usd,
                "nano_usd": nano_usd,
            }
        )
        if rate_version is not UNSET:
            field_dict["rate_version"] = rate_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        total_usd = d.pop("total_usd")

        nano_usd = d.pop("nano_usd")

        def _parse_rate_version(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        rate_version = _parse_rate_version(d.pop("rate_version", UNSET))

        get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0 = cls(
            total_usd=total_usd,
            nano_usd=nano_usd,
            rate_version=rate_version,
        )

        return get_api_gateway_v1_spend_events_response_200_data_item_data_cost_type_0
