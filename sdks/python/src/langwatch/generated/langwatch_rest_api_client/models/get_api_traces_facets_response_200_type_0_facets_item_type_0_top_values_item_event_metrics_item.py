from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        values = []
        for values_item_data in self.values:
            values_item = values_item_data.to_dict()
            values.append(values_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item

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
