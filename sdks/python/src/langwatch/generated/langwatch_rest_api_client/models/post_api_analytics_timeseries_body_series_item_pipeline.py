from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_analytics_timeseries_body_series_item_pipeline_aggregation import (
    PostApiAnalyticsTimeseriesBodySeriesItemPipelineAggregation,
)
from ..models.post_api_analytics_timeseries_body_series_item_pipeline_field import (
    PostApiAnalyticsTimeseriesBodySeriesItemPipelineField,
)

T = TypeVar("T", bound="PostApiAnalyticsTimeseriesBodySeriesItemPipeline")


@_attrs_define
class PostApiAnalyticsTimeseriesBodySeriesItemPipeline:
    """
    Attributes:
        field (PostApiAnalyticsTimeseriesBodySeriesItemPipelineField):
        aggregation (PostApiAnalyticsTimeseriesBodySeriesItemPipelineAggregation):
    """

    field: PostApiAnalyticsTimeseriesBodySeriesItemPipelineField
    aggregation: PostApiAnalyticsTimeseriesBodySeriesItemPipelineAggregation
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        aggregation = self.aggregation.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        field = PostApiAnalyticsTimeseriesBodySeriesItemPipelineField(d.pop("field"))

        aggregation = PostApiAnalyticsTimeseriesBodySeriesItemPipelineAggregation(d.pop("aggregation"))

        post_api_analytics_timeseries_body_series_item_pipeline = cls(
            field=field,
            aggregation=aggregation,
        )

        post_api_analytics_timeseries_body_series_item_pipeline.additional_properties = d
        return post_api_analytics_timeseries_body_series_item_pipeline

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
