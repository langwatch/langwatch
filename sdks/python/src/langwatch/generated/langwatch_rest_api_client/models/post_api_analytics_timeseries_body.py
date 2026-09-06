from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_analytics_timeseries_body_group_by import PostApiAnalyticsTimeseriesBodyGroupBy
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_analytics_timeseries_body_filters import PostApiAnalyticsTimeseriesBodyFilters
    from ..models.post_api_analytics_timeseries_body_series_item import PostApiAnalyticsTimeseriesBodySeriesItem


T = TypeVar("T", bound="PostApiAnalyticsTimeseriesBody")


@_attrs_define
class PostApiAnalyticsTimeseriesBody:
    """
    Attributes:
        start_date (float | str):
        end_date (float | str):
        series (list[PostApiAnalyticsTimeseriesBodySeriesItem]):
        time_zone (str):
        query (str | Unset):
        filters (PostApiAnalyticsTimeseriesBodyFilters | Unset):
        trace_ids (list[str] | Unset):
        negate_filters (bool | Unset):
        group_by (PostApiAnalyticsTimeseriesBodyGroupBy | Unset):
        group_by_key (str | Unset):
        time_scale (int | Literal['full'] | Unset):
    """

    start_date: float | str
    end_date: float | str
    series: list[PostApiAnalyticsTimeseriesBodySeriesItem]
    time_zone: str
    query: str | Unset = UNSET
    filters: PostApiAnalyticsTimeseriesBodyFilters | Unset = UNSET
    trace_ids: list[str] | Unset = UNSET
    negate_filters: bool | Unset = UNSET
    group_by: PostApiAnalyticsTimeseriesBodyGroupBy | Unset = UNSET
    group_by_key: str | Unset = UNSET
    time_scale: int | Literal["full"] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        start_date: float | str
        start_date = self.start_date

        end_date: float | str
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

        time_scale: int | Literal["full"] | Unset
        if isinstance(self.time_scale, Unset):
            time_scale = UNSET
        else:
            time_scale = self.time_scale

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.post_api_analytics_timeseries_body_filters import PostApiAnalyticsTimeseriesBodyFilters
        from ..models.post_api_analytics_timeseries_body_series_item import PostApiAnalyticsTimeseriesBodySeriesItem

        d = dict(src_dict)

        def _parse_start_date(data: object) -> float | str:
            return cast(float | str, data)

        start_date = _parse_start_date(d.pop("startDate"))

        def _parse_end_date(data: object) -> float | str:
            return cast(float | str, data)

        end_date = _parse_end_date(d.pop("endDate"))

        series = []
        _series = d.pop("series")
        for series_item_data in _series:
            series_item = PostApiAnalyticsTimeseriesBodySeriesItem.from_dict(series_item_data)

            series.append(series_item)

        time_zone = d.pop("timeZone")

        query = d.pop("query", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: PostApiAnalyticsTimeseriesBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiAnalyticsTimeseriesBodyFilters.from_dict(_filters)

        trace_ids = cast(list[str], d.pop("traceIds", UNSET))

        negate_filters = d.pop("negateFilters", UNSET)

        _group_by = d.pop("groupBy", UNSET)
        group_by: PostApiAnalyticsTimeseriesBodyGroupBy | Unset
        if isinstance(_group_by, Unset):
            group_by = UNSET
        else:
            group_by = PostApiAnalyticsTimeseriesBodyGroupBy(_group_by)

        group_by_key = d.pop("groupByKey", UNSET)

        def _parse_time_scale(data: object) -> int | Literal["full"] | Unset:
            if isinstance(data, Unset):
                return data
            time_scale_type_0 = cast(Literal["full"], data)
            if time_scale_type_0 != "full":
                raise ValueError(f"timeScale_type_0 must match const 'full', got '{time_scale_type_0}'")
            return time_scale_type_0
            return cast(int | Literal["full"] | Unset, data)

        time_scale = _parse_time_scale(d.pop("timeScale", UNSET))

        post_api_analytics_timeseries_body = cls(
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

        post_api_analytics_timeseries_body.additional_properties = d
        return post_api_analytics_timeseries_body

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
