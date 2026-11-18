from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item_values_item import (
        GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItemValuesItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItem:
    """
    Attributes:
        key (str):
        values (list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItemValuesItem]):
    """

    key: str
    values: list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItemValuesItem]

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        values = []
        for values_item_data in self.values:
            values_item = values_item_data.to_dict()
            values.append(values_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "key": key,
                "values": values,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item_values_item import (
            GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItemValuesItem,
        )

        d = dict(src_dict)
        key = d.pop("key")

        values = []
        _values = d.pop("values")
        for values_item_data in _values:
            values_item = (
                GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItemValuesItem.from_dict(
                    values_item_data
                )
            )

            values.append(values_item)

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item = cls(
            key=key,
            values=values,
        )

        return get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item
