from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_spend_summaries_response_200_data_item_cost import (
        GetApiGatewayV1SpendSummariesResponse200DataItemCost,
    )
    from ..models.get_api_gateway_v1_spend_summaries_response_200_data_item_group import (
        GetApiGatewayV1SpendSummariesResponse200DataItemGroup,
    )
    from ..models.get_api_gateway_v1_spend_summaries_response_200_data_item_usage import (
        GetApiGatewayV1SpendSummariesResponse200DataItemUsage,
    )


T = TypeVar("T", bound="GetApiGatewayV1SpendSummariesResponse200DataItem")


@_attrs_define
class GetApiGatewayV1SpendSummariesResponse200DataItem:
    """
    Attributes:
        key (str):
        group (GetApiGatewayV1SpendSummariesResponse200DataItemGroup):
        bucket_start (None | str):
        event_count (int):
        settled_count (int):
        usage (GetApiGatewayV1SpendSummariesResponse200DataItemUsage):
        cost (GetApiGatewayV1SpendSummariesResponse200DataItemCost):
    """

    key: str
    group: GetApiGatewayV1SpendSummariesResponse200DataItemGroup
    bucket_start: None | str
    event_count: int
    settled_count: int
    usage: GetApiGatewayV1SpendSummariesResponse200DataItemUsage
    cost: GetApiGatewayV1SpendSummariesResponse200DataItemCost
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        group = self.group.to_dict()

        bucket_start: None | str
        bucket_start = self.bucket_start

        event_count = self.event_count

        settled_count = self.settled_count

        usage = self.usage.to_dict()

        cost = self.cost.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "group": group,
                "bucket_start": bucket_start,
                "event_count": event_count,
                "settled_count": settled_count,
                "usage": usage,
                "cost": cost,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_spend_summaries_response_200_data_item_cost import (
            GetApiGatewayV1SpendSummariesResponse200DataItemCost,
        )
        from ..models.get_api_gateway_v1_spend_summaries_response_200_data_item_group import (
            GetApiGatewayV1SpendSummariesResponse200DataItemGroup,
        )
        from ..models.get_api_gateway_v1_spend_summaries_response_200_data_item_usage import (
            GetApiGatewayV1SpendSummariesResponse200DataItemUsage,
        )

        d = dict(src_dict)
        key = d.pop("key")

        group = GetApiGatewayV1SpendSummariesResponse200DataItemGroup.from_dict(d.pop("group"))

        def _parse_bucket_start(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        bucket_start = _parse_bucket_start(d.pop("bucket_start"))

        event_count = d.pop("event_count")

        settled_count = d.pop("settled_count")

        usage = GetApiGatewayV1SpendSummariesResponse200DataItemUsage.from_dict(d.pop("usage"))

        cost = GetApiGatewayV1SpendSummariesResponse200DataItemCost.from_dict(d.pop("cost"))

        get_api_gateway_v1_spend_summaries_response_200_data_item = cls(
            key=key,
            group=group,
            bucket_start=bucket_start,
            event_count=event_count,
            settled_count=settled_count,
            usage=usage,
            cost=cost,
        )

        get_api_gateway_v1_spend_summaries_response_200_data_item.additional_properties = d
        return get_api_gateway_v1_spend_summaries_response_200_data_item

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
