from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiMeUsageResponse200DailyBucketsItem")


@_attrs_define
class GetApiMeUsageResponse200DailyBucketsItem:
    """
    Attributes:
        day (str):
        spent_usd (float):
        billed_usd (float):
        requests (float):
    """

    day: str
    spent_usd: float
    billed_usd: float
    requests: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        day = self.day

        spent_usd = self.spent_usd

        billed_usd = self.billed_usd

        requests = self.requests

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "day": day,
                "spentUsd": spent_usd,
                "billedUsd": billed_usd,
                "requests": requests,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        day = d.pop("day")

        spent_usd = d.pop("spentUsd")

        billed_usd = d.pop("billedUsd")

        requests = d.pop("requests")

        get_api_me_usage_response_200_daily_buckets_item = cls(
            day=day,
            spent_usd=spent_usd,
            billed_usd=billed_usd,
            requests=requests,
        )

        get_api_me_usage_response_200_daily_buckets_item.additional_properties = d
        return get_api_me_usage_response_200_daily_buckets_item

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
