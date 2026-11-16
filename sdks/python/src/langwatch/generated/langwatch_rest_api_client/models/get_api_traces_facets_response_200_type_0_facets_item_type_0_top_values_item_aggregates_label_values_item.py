from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem:
    """
    Attributes:
        value (str):
        count (float):
    """

    value: str
    count: float

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        count = self.count

        field_dict: dict[str, Any] = {}

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

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates_label_values_item = cls(
            value=value,
            count=count,
        )

        return get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates_label_values_item
