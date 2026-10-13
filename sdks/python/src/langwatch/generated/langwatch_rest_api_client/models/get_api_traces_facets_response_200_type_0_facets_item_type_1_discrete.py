from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        values = []
        for values_item_data in self.values:
            values_item = values_item_data.to_dict()
            values.append(values_item)

        distinct_count = self.distinct_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item_type_1_discrete

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
