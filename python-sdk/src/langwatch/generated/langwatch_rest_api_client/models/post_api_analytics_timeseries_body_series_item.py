from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_analytics_timeseries_body_series_item_aggregation import (
    PostApiAnalyticsTimeseriesBodySeriesItemAggregation,
)
from ..models.post_api_analytics_timeseries_body_series_item_metric import (
    PostApiAnalyticsTimeseriesBodySeriesItemMetric,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_analytics_timeseries_body_series_item_filters import (
        PostApiAnalyticsTimeseriesBodySeriesItemFilters,
    )
    from ..models.post_api_analytics_timeseries_body_series_item_pipeline import (
        PostApiAnalyticsTimeseriesBodySeriesItemPipeline,
    )


T = TypeVar("T", bound="PostApiAnalyticsTimeseriesBodySeriesItem")


@_attrs_define
class PostApiAnalyticsTimeseriesBodySeriesItem:
    """
    Attributes:
        metric (PostApiAnalyticsTimeseriesBodySeriesItemMetric):
        aggregation (PostApiAnalyticsTimeseriesBodySeriesItemAggregation):
        key (str | Unset):
        subkey (str | Unset):
        pipeline (PostApiAnalyticsTimeseriesBodySeriesItemPipeline | Unset):
        filters (PostApiAnalyticsTimeseriesBodySeriesItemFilters | Unset):
        as_percent (bool | Unset):
    """

    metric: PostApiAnalyticsTimeseriesBodySeriesItemMetric
    aggregation: PostApiAnalyticsTimeseriesBodySeriesItemAggregation
    key: str | Unset = UNSET
    subkey: str | Unset = UNSET
    pipeline: PostApiAnalyticsTimeseriesBodySeriesItemPipeline | Unset = UNSET
    filters: PostApiAnalyticsTimeseriesBodySeriesItemFilters | Unset = UNSET
    as_percent: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        metric = self.metric.value

        aggregation = self.aggregation.value

        key = self.key

        subkey = self.subkey

        pipeline: dict[str, Any] | Unset = UNSET
        if not isinstance(self.pipeline, Unset):
            pipeline = self.pipeline.to_dict()

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        as_percent = self.as_percent

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "metric": metric,
                "aggregation": aggregation,
            }
        )
        if key is not UNSET:
            field_dict["key"] = key
        if subkey is not UNSET:
            field_dict["subkey"] = subkey
        if pipeline is not UNSET:
            field_dict["pipeline"] = pipeline
        if filters is not UNSET:
            field_dict["filters"] = filters
        if as_percent is not UNSET:
            field_dict["asPercent"] = as_percent

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_analytics_timeseries_body_series_item_filters import (
            PostApiAnalyticsTimeseriesBodySeriesItemFilters,
        )
        from ..models.post_api_analytics_timeseries_body_series_item_pipeline import (
            PostApiAnalyticsTimeseriesBodySeriesItemPipeline,
        )

        d = dict(src_dict)
        metric = PostApiAnalyticsTimeseriesBodySeriesItemMetric(d.pop("metric"))

        aggregation = PostApiAnalyticsTimeseriesBodySeriesItemAggregation(d.pop("aggregation"))

        key = d.pop("key", UNSET)

        subkey = d.pop("subkey", UNSET)

        _pipeline = d.pop("pipeline", UNSET)
        pipeline: PostApiAnalyticsTimeseriesBodySeriesItemPipeline | Unset
        if isinstance(_pipeline, Unset):
            pipeline = UNSET
        else:
            pipeline = PostApiAnalyticsTimeseriesBodySeriesItemPipeline.from_dict(_pipeline)

        _filters = d.pop("filters", UNSET)
        filters: PostApiAnalyticsTimeseriesBodySeriesItemFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiAnalyticsTimeseriesBodySeriesItemFilters.from_dict(_filters)

        as_percent = d.pop("asPercent", UNSET)

        post_api_analytics_timeseries_body_series_item = cls(
            metric=metric,
            aggregation=aggregation,
            key=key,
            subkey=subkey,
            pipeline=pipeline,
            filters=filters,
            as_percent=as_percent,
        )

        post_api_analytics_timeseries_body_series_item.additional_properties = d
        return post_api_analytics_timeseries_body_series_item

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
