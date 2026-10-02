from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_group import (
    GetApiTracesFacetsResponse200Type0FacetsItemType0Group,
)

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item import (
        GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType0")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType0:
    """
    Attributes:
        key (str):
        kind (Literal['categorical']):
        label (str):
        group (GetApiTracesFacetsResponse200Type0FacetsItemType0Group):
        top_values (list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItem]):
        total_distinct (float):
    """

    key: str
    kind: Literal["categorical"]
    label: str
    group: GetApiTracesFacetsResponse200Type0FacetsItemType0Group
    top_values: list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItem]
    total_distinct: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        kind = self.kind

        label = self.label

        group = self.group.value

        top_values = []
        for top_values_item_data in self.top_values:
            top_values_item = top_values_item_data.to_dict()
            top_values.append(top_values_item)

        total_distinct = self.total_distinct

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "kind": kind,
                "label": label,
                "group": group,
                "topValues": top_values,
                "totalDistinct": total_distinct,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item import (
            GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItem,
        )

        d = dict(src_dict)
        key = d.pop("key")

        kind = cast(Literal["categorical"], d.pop("kind"))
        if kind != "categorical":
            raise ValueError(f"kind must match const 'categorical', got '{kind}'")

        label = d.pop("label")

        group = GetApiTracesFacetsResponse200Type0FacetsItemType0Group(d.pop("group"))

        top_values = []
        _top_values = d.pop("topValues")
        for top_values_item_data in _top_values:
            top_values_item = GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItem.from_dict(
                top_values_item_data
            )

            top_values.append(top_values_item)

        total_distinct = d.pop("totalDistinct")

        get_api_traces_facets_response_200_type_0_facets_item_type_0 = cls(
            key=key,
            kind=kind,
            label=label,
            group=group,
            top_values=top_values,
            total_distinct=total_distinct,
        )

        get_api_traces_facets_response_200_type_0_facets_item_type_0.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item_type_0

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
