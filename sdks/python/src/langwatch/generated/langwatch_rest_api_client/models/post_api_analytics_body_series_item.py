from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_analytics_body_series_item_aggregation import PostApiAnalyticsBodySeriesItemAggregation
from ..models.post_api_analytics_body_series_item_metric import PostApiAnalyticsBodySeriesItemMetric
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_analytics_body_series_item_filters import PostApiAnalyticsBodySeriesItemFilters
    from ..models.post_api_analytics_body_series_item_pipeline import PostApiAnalyticsBodySeriesItemPipeline


T = TypeVar("T", bound="PostApiAnalyticsBodySeriesItem")


@_attrs_define
class PostApiAnalyticsBodySeriesItem:
    """
    Attributes:
        metric (PostApiAnalyticsBodySeriesItemMetric):
        aggregation (PostApiAnalyticsBodySeriesItemAggregation):
        key (str | Unset):
        subkey (str | Unset):
        pipeline (PostApiAnalyticsBodySeriesItemPipeline | Unset):
        filters (PostApiAnalyticsBodySeriesItemFilters | Unset):
        as_percent (bool | Unset):
    """

    metric: PostApiAnalyticsBodySeriesItemMetric
    aggregation: PostApiAnalyticsBodySeriesItemAggregation
    key: str | Unset = UNSET
    subkey: str | Unset = UNSET
    pipeline: PostApiAnalyticsBodySeriesItemPipeline | Unset = UNSET
    filters: PostApiAnalyticsBodySeriesItemFilters | Unset = UNSET
    as_percent: bool | Unset = UNSET

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
        from ..models.post_api_analytics_body_series_item_filters import PostApiAnalyticsBodySeriesItemFilters
        from ..models.post_api_analytics_body_series_item_pipeline import PostApiAnalyticsBodySeriesItemPipeline

        d = dict(src_dict)
        metric = PostApiAnalyticsBodySeriesItemMetric(d.pop("metric"))

        aggregation = PostApiAnalyticsBodySeriesItemAggregation(d.pop("aggregation"))

        key = d.pop("key", UNSET)

        subkey = d.pop("subkey", UNSET)

        _pipeline = d.pop("pipeline", UNSET)
        pipeline: PostApiAnalyticsBodySeriesItemPipeline | Unset
        if isinstance(_pipeline, Unset):
            pipeline = UNSET
        else:
            pipeline = PostApiAnalyticsBodySeriesItemPipeline.from_dict(_pipeline)

        _filters = d.pop("filters", UNSET)
        filters: PostApiAnalyticsBodySeriesItemFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiAnalyticsBodySeriesItemFilters.from_dict(_filters)

        as_percent = d.pop("asPercent", UNSET)

        post_api_analytics_body_series_item = cls(
            metric=metric,
            aggregation=aggregation,
            key=key,
            subkey=subkey,
            pipeline=pipeline,
            filters=filters,
            as_percent=as_percent,
        )

        return post_api_analytics_body_series_item
