from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_analytics_response_200_current_period_item import (
        PostApiAnalyticsResponse200CurrentPeriodItem,
    )
    from ..models.post_api_analytics_response_200_previous_period_item import (
        PostApiAnalyticsResponse200PreviousPeriodItem,
    )


T = TypeVar("T", bound="PostApiAnalyticsResponse200")


@_attrs_define
class PostApiAnalyticsResponse200:
    """
    Attributes:
        current_period (list[PostApiAnalyticsResponse200CurrentPeriodItem]):
        previous_period (list[PostApiAnalyticsResponse200PreviousPeriodItem]):
    """

    current_period: list[PostApiAnalyticsResponse200CurrentPeriodItem]
    previous_period: list[PostApiAnalyticsResponse200PreviousPeriodItem]

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
        from ..models.post_api_analytics_response_200_current_period_item import (
            PostApiAnalyticsResponse200CurrentPeriodItem,
        )
        from ..models.post_api_analytics_response_200_previous_period_item import (
            PostApiAnalyticsResponse200PreviousPeriodItem,
        )

        d = dict(src_dict)
        current_period = []
        _current_period = d.pop("currentPeriod")
        for current_period_item_data in _current_period:
            current_period_item = PostApiAnalyticsResponse200CurrentPeriodItem.from_dict(current_period_item_data)

            current_period.append(current_period_item)

        previous_period = []
        _previous_period = d.pop("previousPeriod")
        for previous_period_item_data in _previous_period:
            previous_period_item = PostApiAnalyticsResponse200PreviousPeriodItem.from_dict(previous_period_item_data)

            previous_period.append(previous_period_item)

        post_api_analytics_response_200 = cls(
            current_period=current_period,
            previous_period=previous_period,
        )

        return post_api_analytics_response_200
