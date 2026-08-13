from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_analytics_body_group_by import PostApiAnalyticsBodyGroupBy
from ..models.post_api_analytics_body_time_scale_type_0 import PostApiAnalyticsBodyTimeScaleType0
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_analytics_body_filters import PostApiAnalyticsBodyFilters
    from ..models.post_api_analytics_body_series_item import PostApiAnalyticsBodySeriesItem


T = TypeVar("T", bound="PostApiAnalyticsBody")


@_attrs_define
class PostApiAnalyticsBody:
    """
    Attributes:
        start_date (float):
        end_date (float):
        series (list[PostApiAnalyticsBodySeriesItem]):
        time_zone (str):
        query (str | Unset):
        filters (PostApiAnalyticsBodyFilters | Unset):
        trace_ids (list[str] | Unset):
        negate_filters (bool | Unset):
        group_by (PostApiAnalyticsBodyGroupBy | Unset):
        group_by_key (str | Unset):
        time_scale (int | PostApiAnalyticsBodyTimeScaleType0 | Unset):
    """

    start_date: float
    end_date: float
    series: list[PostApiAnalyticsBodySeriesItem]
    time_zone: str
    query: str | Unset = UNSET
    filters: PostApiAnalyticsBodyFilters | Unset = UNSET
    trace_ids: list[str] | Unset = UNSET
    negate_filters: bool | Unset = UNSET
    group_by: PostApiAnalyticsBodyGroupBy | Unset = UNSET
    group_by_key: str | Unset = UNSET
    time_scale: int | PostApiAnalyticsBodyTimeScaleType0 | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        start_date = self.start_date

        end_date = self.end_date

        series = []
        for series_item_data in self.series:
            series_item = series_item_data.to_dict()
            series.append(series_item)

        time_zone = self.time_zone

        query = self.query

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        trace_ids: list[str] | Unset = UNSET
        if not isinstance(self.trace_ids, Unset):
            trace_ids = self.trace_ids

        negate_filters = self.negate_filters

        group_by: str | Unset = UNSET
        if not isinstance(self.group_by, Unset):
            group_by = self.group_by.value

        group_by_key = self.group_by_key

        time_scale: int | str | Unset
        if isinstance(self.time_scale, Unset):
            time_scale = UNSET
        elif isinstance(self.time_scale, PostApiAnalyticsBodyTimeScaleType0):
            time_scale = self.time_scale.value
        else:
            time_scale = self.time_scale

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "startDate": start_date,
                "endDate": end_date,
                "series": series,
                "timeZone": time_zone,
            }
        )
        if query is not UNSET:
            field_dict["query"] = query
        if filters is not UNSET:
            field_dict["filters"] = filters
        if trace_ids is not UNSET:
            field_dict["traceIds"] = trace_ids
        if negate_filters is not UNSET:
            field_dict["negateFilters"] = negate_filters
        if group_by is not UNSET:
            field_dict["groupBy"] = group_by
        if group_by_key is not UNSET:
            field_dict["groupByKey"] = group_by_key
        if time_scale is not UNSET:
            field_dict["timeScale"] = time_scale

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_analytics_body_filters import PostApiAnalyticsBodyFilters
        from ..models.post_api_analytics_body_series_item import PostApiAnalyticsBodySeriesItem

        d = dict(src_dict)
        start_date = d.pop("startDate")

        end_date = d.pop("endDate")

        series = []
        _series = d.pop("series")
        for series_item_data in _series:
            series_item = PostApiAnalyticsBodySeriesItem.from_dict(series_item_data)

            series.append(series_item)

        time_zone = d.pop("timeZone")

        query = d.pop("query", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: PostApiAnalyticsBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiAnalyticsBodyFilters.from_dict(_filters)

        trace_ids = cast(list[str], d.pop("traceIds", UNSET))

        negate_filters = d.pop("negateFilters", UNSET)

        _group_by = d.pop("groupBy", UNSET)
        group_by: PostApiAnalyticsBodyGroupBy | Unset
        if isinstance(_group_by, Unset):
            group_by = UNSET
        else:
            group_by = PostApiAnalyticsBodyGroupBy(_group_by)

        group_by_key = d.pop("groupByKey", UNSET)

        def _parse_time_scale(data: object) -> int | PostApiAnalyticsBodyTimeScaleType0 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                time_scale_type_0 = PostApiAnalyticsBodyTimeScaleType0(data)

                return time_scale_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(int | PostApiAnalyticsBodyTimeScaleType0 | Unset, data)

        time_scale = _parse_time_scale(d.pop("timeScale", UNSET))

        post_api_analytics_body = cls(
            start_date=start_date,
            end_date=end_date,
            series=series,
            time_zone=time_zone,
            query=query,
            filters=filters,
            trace_ids=trace_ids,
            negate_filters=negate_filters,
            group_by=group_by,
            group_by_key=group_by_key,
            time_scale=time_scale,
        )

        return post_api_analytics_body
