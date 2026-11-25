from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_1_values_item import (
        GetApiTracesFacetsResponse200Type1ValuesItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type1")


@_attrs_define
class GetApiTracesFacetsResponse200Type1:
    """
    Attributes:
        values (list[GetApiTracesFacetsResponse200Type1ValuesItem]):
        total (float): Distinct values the field holds in the window, before paging.
        has_more (bool):
    """

    values: list[GetApiTracesFacetsResponse200Type1ValuesItem]
    total: float
    has_more: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        values = []
        for values_item_data in self.values:
            values_item = values_item_data.to_dict()
            values.append(values_item)

        total = self.total

        has_more = self.has_more

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "values": values,
                "total": total,
                "hasMore": has_more,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_1_values_item import (
            GetApiTracesFacetsResponse200Type1ValuesItem,
        )

        d = dict(src_dict)
        values = []
        _values = d.pop("values")
        for values_item_data in _values:
            values_item = GetApiTracesFacetsResponse200Type1ValuesItem.from_dict(values_item_data)

            values.append(values_item)

        total = d.pop("total")

        has_more = d.pop("hasMore")

        get_api_traces_facets_response_200_type_1 = cls(
            values=values,
            total=total,
            has_more=has_more,
        )

        get_api_traces_facets_response_200_type_1.additional_properties = d
        return get_api_traces_facets_response_200_type_1

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
