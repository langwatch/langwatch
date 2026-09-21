from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_budgets_response_200_data_item import GetApiGatewayV1BudgetsResponse200DataItem


T = TypeVar("T", bound="GetApiGatewayV1BudgetsResponse200")


@_attrs_define
class GetApiGatewayV1BudgetsResponse200:
    """
    Attributes:
        data (list[GetApiGatewayV1BudgetsResponse200DataItem]):
        spend_available (bool):
        next_cursor (None | str): Pass back as `cursor` for the next page. Null means the walk is exhausted; a full page
            does NOT mean there is more.
    """

    data: list[GetApiGatewayV1BudgetsResponse200DataItem]
    spend_available: bool
    next_cursor: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        spend_available = self.spend_available

        next_cursor: None | str
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "data": data,
                "spend_available": spend_available,
                "next_cursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_budgets_response_200_data_item import GetApiGatewayV1BudgetsResponse200DataItem

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiGatewayV1BudgetsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        spend_available = d.pop("spend_available")

        def _parse_next_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_cursor = _parse_next_cursor(d.pop("next_cursor"))

        get_api_gateway_v1_budgets_response_200 = cls(
            data=data,
            spend_available=spend_available,
            next_cursor=next_cursor,
        )

        get_api_gateway_v1_budgets_response_200.additional_properties = d
        return get_api_gateway_v1_budgets_response_200

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
