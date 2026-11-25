from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_analytics_timeseries_response_200_current_period_item import (
        PostApiAnalyticsTimeseriesResponse200CurrentPeriodItem,
    )
    from ..models.post_api_analytics_timeseries_response_200_previous_period_item import (
        PostApiAnalyticsTimeseriesResponse200PreviousPeriodItem,
    )


T = TypeVar("T", bound="PostApiAnalyticsTimeseriesResponse200")


@_attrs_define
class PostApiAnalyticsTimeseriesResponse200:
    """
    Attributes:
        current_period (list[PostApiAnalyticsTimeseriesResponse200CurrentPeriodItem]):
        previous_period (list[PostApiAnalyticsTimeseriesResponse200PreviousPeriodItem]):
    """

    current_period: list[PostApiAnalyticsTimeseriesResponse200CurrentPeriodItem]
    previous_period: list[PostApiAnalyticsTimeseriesResponse200PreviousPeriodItem]

    def to_dict(self) -> dict[str, Any]:
        current_period = []
        for current_period_item_data in self.current_period:
            current_period_item = current_period_item_data.to_dict()
            current_period.append(current_period_item)

        previous_period = []
        for previous_period_item_data in self.previous_period:
            previous_period_item = previous_period_item_data.to_dict()
            previous_period.append(previous_period_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "currentPeriod": current_period,
                "previousPeriod": previous_period,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_analytics_timeseries_response_200_current_period_item import (
            PostApiAnalyticsTimeseriesResponse200CurrentPeriodItem,
        )
        from ..models.post_api_analytics_timeseries_response_200_previous_period_item import (
            PostApiAnalyticsTimeseriesResponse200PreviousPeriodItem,
        )

        d = dict(src_dict)
        current_period = []
        _current_period = d.pop("currentPeriod")
        for current_period_item_data in _current_period:
            current_period_item = PostApiAnalyticsTimeseriesResponse200CurrentPeriodItem.from_dict(
                current_period_item_data
            )

            current_period.append(current_period_item)

        previous_period = []
        _previous_period = d.pop("previousPeriod")
        for previous_period_item_data in _previous_period:
            previous_period_item = PostApiAnalyticsTimeseriesResponse200PreviousPeriodItem.from_dict(
                previous_period_item_data
            )

            previous_period.append(previous_period_item)

        post_api_analytics_timeseries_response_200 = cls(
            current_period=current_period,
            previous_period=previous_period,
        )

        return post_api_analytics_timeseries_response_200
