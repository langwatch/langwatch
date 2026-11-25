from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        day = self.day

        spent_usd = self.spent_usd

        billed_usd = self.billed_usd

        requests = self.requests

        field_dict: dict[str, Any] = {}

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

        return get_api_me_usage_response_200_daily_buckets_item
