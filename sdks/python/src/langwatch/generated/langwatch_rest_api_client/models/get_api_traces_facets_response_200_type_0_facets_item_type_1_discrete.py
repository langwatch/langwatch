from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete_values_item import (
        GetApiTracesFacetsResponse200Type0FacetsItemType1DiscreteValuesItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType1Discrete:
    """
    Attributes:
        values (list[GetApiTracesFacetsResponse200Type0FacetsItemType1DiscreteValuesItem]):
        distinct_count (float):
    """

    values: list[GetApiTracesFacetsResponse200Type0FacetsItemType1DiscreteValuesItem]
    distinct_count: float

    def to_dict(self) -> dict[str, Any]:
        values = []
        for values_item_data in self.values:
            values_item = values_item_data.to_dict()
            values.append(values_item)

        distinct_count = self.distinct_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "values": values,
                "distinctCount": distinct_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete_values_item import (
            GetApiTracesFacetsResponse200Type0FacetsItemType1DiscreteValuesItem,
        )

        d = dict(src_dict)
        values = []
        _values = d.pop("values")
        for values_item_data in _values:
            values_item = GetApiTracesFacetsResponse200Type0FacetsItemType1DiscreteValuesItem.from_dict(
                values_item_data
            )

            values.append(values_item)

        distinct_count = d.pop("distinctCount")

        get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete = cls(
            values=values,
            distinct_count=distinct_count,
        )

        return get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete
