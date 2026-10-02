from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItemValuesItem")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemEventMetricsItemValuesItem:
    """
    Attributes:
        value (str):
        count (float):
    """

    value: str
    count: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        count = self.count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "value": value,
                "count": count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value")

        count = d.pop("count")

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item_values_item = (
            cls(
                value=value,
                count=count,
            )
        )

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item_values_item.additional_properties = d
        return (
            get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_event_metrics_item_values_item
        )

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
