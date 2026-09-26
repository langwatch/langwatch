from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item import (
        GetApiTracesFacetsResponse200Type0FacetsItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0")


@_attrs_define
class GetApiTracesFacetsResponse200Type0:
    """
    Attributes:
        facets (list[GetApiTracesFacetsResponse200Type0FacetsItem]):
        pending (bool): True when the payload is still being computed and what you have is the last committed one,
            possibly empty. Call again shortly.
    """

    facets: list[GetApiTracesFacetsResponse200Type0FacetsItem]
    pending: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        facets = []
        for facets_item_data in self.facets:
            facets_item = facets_item_data.to_dict()
            facets.append(facets_item)

        pending = self.pending

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "facets": facets,
                "pending": pending,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item import (
            GetApiTracesFacetsResponse200Type0FacetsItem,
        )

        d = dict(src_dict)
        facets = []
        _facets = d.pop("facets")
        for facets_item_data in _facets:
            facets_item = GetApiTracesFacetsResponse200Type0FacetsItem.from_dict(facets_item_data)

            facets.append(facets_item)

        pending = d.pop("pending")

        get_api_traces_facets_response_200_type_0 = cls(
            facets=facets,
            pending=pending,
        )

        get_api_traces_facets_response_200_type_0.additional_properties = d
        return get_api_traces_facets_response_200_type_0

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
