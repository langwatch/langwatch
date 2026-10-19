from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates import (
        GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates,
    )
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item import (
        GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItem")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItem:
    """
    Attributes:
        value (str):
        count (float):
        label (str | Unset):
        aggregates (GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates | Unset):
        event_metrics (list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem] | Unset):
    """

    value: str
    count: float
    label: str | Unset = UNSET
    aggregates: GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates | Unset = UNSET
    event_metrics: list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        count = self.count

        label = self.label

        aggregates: dict[str, Any] | Unset = UNSET
        if not isinstance(self.aggregates, Unset):
            aggregates = self.aggregates.to_dict()

        event_metrics: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.event_metrics, Unset):
            event_metrics = []
            for event_metrics_item_data in self.event_metrics:
                event_metrics_item = event_metrics_item_data.to_dict()
                event_metrics.append(event_metrics_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "value": value,
                "count": count,
            }
        )
        if label is not UNSET:
            field_dict["label"] = label
        if aggregates is not UNSET:
            field_dict["aggregates"] = aggregates
        if event_metrics is not UNSET:
            field_dict["eventMetrics"] = event_metrics

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates import (
            GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates,
        )
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item import (
            GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem,
        )

        d = dict(src_dict)
        value = d.pop("value")

        count = d.pop("count")

        label = d.pop("label", UNSET)

        _aggregates = d.pop("aggregates", UNSET)
        aggregates: GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates | Unset
        if isinstance(_aggregates, Unset):
            aggregates = UNSET
        else:
            aggregates = GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates.from_dict(_aggregates)

        _event_metrics = d.pop("eventMetrics", UNSET)
        event_metrics: list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem] | Unset = (
            UNSET
        )
        if _event_metrics is not UNSET:
            event_metrics = []
            for event_metrics_item_data in _event_metrics:
                event_metrics_item = (
                    GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem.from_dict(
                        event_metrics_item_data
                    )
                )

                event_metrics.append(event_metrics_item)

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item = cls(
            value=value,
            count=count,
            label=label,
            aggregates=aggregates,
            event_metrics=event_metrics,
        )

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item

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
