from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data_caps_item import (
        GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItem,
    )
    from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data_cost import (
        GetApiGatewayV1EndUsersByIdSpendResponse200DataCost,
    )
    from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data_usage import (
        GetApiGatewayV1EndUsersByIdSpendResponse200DataUsage,
    )


T = TypeVar("T", bound="GetApiGatewayV1EndUsersByIdSpendResponse200Data")


@_attrs_define
class GetApiGatewayV1EndUsersByIdSpendResponse200Data:
    """
    Attributes:
        end_user_id (str):
        window (str):
        from_ (str):
        to (str):
        cost (GetApiGatewayV1EndUsersByIdSpendResponse200DataCost):
        request_count (int):
        usage (GetApiGatewayV1EndUsersByIdSpendResponse200DataUsage):
        caps (list[GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItem]):
    """

    end_user_id: str
    window: str
    from_: str
    to: str
    cost: GetApiGatewayV1EndUsersByIdSpendResponse200DataCost
    request_count: int
    usage: GetApiGatewayV1EndUsersByIdSpendResponse200DataUsage
    caps: list[GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        end_user_id = self.end_user_id

        window = self.window

        from_ = self.from_

        to = self.to

        cost = self.cost.to_dict()

        request_count = self.request_count

        usage = self.usage.to_dict()

        caps = []
        for caps_item_data in self.caps:
            caps_item = caps_item_data.to_dict()
            caps.append(caps_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "end_user_id": end_user_id,
                "window": window,
                "from": from_,
                "to": to,
                "cost": cost,
                "request_count": request_count,
                "usage": usage,
                "caps": caps,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data_caps_item import (
            GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItem,
        )
        from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data_cost import (
            GetApiGatewayV1EndUsersByIdSpendResponse200DataCost,
        )
        from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data_usage import (
            GetApiGatewayV1EndUsersByIdSpendResponse200DataUsage,
        )

        d = dict(src_dict)
        end_user_id = d.pop("end_user_id")

        window = d.pop("window")

        from_ = d.pop("from")

        to = d.pop("to")

        cost = GetApiGatewayV1EndUsersByIdSpendResponse200DataCost.from_dict(d.pop("cost"))

        request_count = d.pop("request_count")

        usage = GetApiGatewayV1EndUsersByIdSpendResponse200DataUsage.from_dict(d.pop("usage"))

        caps = []
        _caps = d.pop("caps")
        for caps_item_data in _caps:
            caps_item = GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItem.from_dict(caps_item_data)

            caps.append(caps_item)

        get_api_gateway_v1_end_users_by_id_spend_response_200_data = cls(
            end_user_id=end_user_id,
            window=window,
            from_=from_,
            to=to,
            cost=cost,
            request_count=request_count,
            usage=usage,
            caps=caps,
        )

        get_api_gateway_v1_end_users_by_id_spend_response_200_data.additional_properties = d
        return get_api_gateway_v1_end_users_by_id_spend_response_200_data

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
