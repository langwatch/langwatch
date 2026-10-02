from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_me_usage_response_200_breakdown_by_model_item import (
        GetApiMeUsageResponse200BreakdownByModelItem,
    )
    from ..models.get_api_me_usage_response_200_daily_buckets_item import GetApiMeUsageResponse200DailyBucketsItem
    from ..models.get_api_me_usage_response_200_summary import GetApiMeUsageResponse200Summary


T = TypeVar("T", bound="GetApiMeUsageResponse200")


@_attrs_define
class GetApiMeUsageResponse200:
    """
    Attributes:
        summary (GetApiMeUsageResponse200Summary):
        daily_buckets (list[GetApiMeUsageResponse200DailyBucketsItem]):
        breakdown_by_model (list[GetApiMeUsageResponse200BreakdownByModelItem]):
    """

    summary: GetApiMeUsageResponse200Summary
    daily_buckets: list[GetApiMeUsageResponse200DailyBucketsItem]
    breakdown_by_model: list[GetApiMeUsageResponse200BreakdownByModelItem]

    def to_dict(self) -> dict[str, Any]:
        summary = self.summary.to_dict()

        daily_buckets = []
        for daily_buckets_item_data in self.daily_buckets:
            daily_buckets_item = daily_buckets_item_data.to_dict()
            daily_buckets.append(daily_buckets_item)

        breakdown_by_model = []
        for breakdown_by_model_item_data in self.breakdown_by_model:
            breakdown_by_model_item = breakdown_by_model_item_data.to_dict()
            breakdown_by_model.append(breakdown_by_model_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "summary": summary,
                "dailyBuckets": daily_buckets,
                "breakdownByModel": breakdown_by_model,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_me_usage_response_200_breakdown_by_model_item import (
            GetApiMeUsageResponse200BreakdownByModelItem,
        )
        from ..models.get_api_me_usage_response_200_daily_buckets_item import GetApiMeUsageResponse200DailyBucketsItem
        from ..models.get_api_me_usage_response_200_summary import GetApiMeUsageResponse200Summary

        d = dict(src_dict)
        summary = GetApiMeUsageResponse200Summary.from_dict(d.pop("summary"))

        daily_buckets = []
        _daily_buckets = d.pop("dailyBuckets")
        for daily_buckets_item_data in _daily_buckets:
            daily_buckets_item = GetApiMeUsageResponse200DailyBucketsItem.from_dict(daily_buckets_item_data)

            daily_buckets.append(daily_buckets_item)

        breakdown_by_model = []
        _breakdown_by_model = d.pop("breakdownByModel")
        for breakdown_by_model_item_data in _breakdown_by_model:
            breakdown_by_model_item = GetApiMeUsageResponse200BreakdownByModelItem.from_dict(
                breakdown_by_model_item_data
            )

            breakdown_by_model.append(breakdown_by_model_item)

        get_api_me_usage_response_200 = cls(
            summary=summary,
            daily_buckets=daily_buckets,
            breakdown_by_model=breakdown_by_model,
        )

        return get_api_me_usage_response_200
