from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_analytics_body_series_item_pipeline_aggregation import (
    PostApiAnalyticsBodySeriesItemPipelineAggregation,
)
from ..models.post_api_analytics_body_series_item_pipeline_field import PostApiAnalyticsBodySeriesItemPipelineField

T = TypeVar("T", bound="PostApiAnalyticsBodySeriesItemPipeline")


@_attrs_define
class PostApiAnalyticsBodySeriesItemPipeline:
    """
    Attributes:
        field (PostApiAnalyticsBodySeriesItemPipelineField):
        aggregation (PostApiAnalyticsBodySeriesItemPipelineAggregation):
    """

    field: PostApiAnalyticsBodySeriesItemPipelineField
    aggregation: PostApiAnalyticsBodySeriesItemPipelineAggregation

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        aggregation = self.aggregation.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "field": field,
                "aggregation": aggregation,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = PostApiAnalyticsBodySeriesItemPipelineField(d.pop("field"))

        aggregation = PostApiAnalyticsBodySeriesItemPipelineAggregation(d.pop("aggregation"))

        post_api_analytics_body_series_item_pipeline = cls(
            field=field,
            aggregation=aggregation,
        )

        return post_api_analytics_body_series_item_pipeline
