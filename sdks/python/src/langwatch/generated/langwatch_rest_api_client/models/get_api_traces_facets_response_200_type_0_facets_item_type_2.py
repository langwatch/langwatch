from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_2_group import (
    GetApiTracesFacetsResponse200Type0FacetsItemType2Group,
)

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_2_top_keys_item import (
        GetApiTracesFacetsResponse200Type0FacetsItemType2TopKeysItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType2")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType2:
    """
    Attributes:
        key (str):
        kind (Literal['dynamic_keys']):
        label (str):
        group (GetApiTracesFacetsResponse200Type0FacetsItemType2Group):
        top_keys (list[GetApiTracesFacetsResponse200Type0FacetsItemType2TopKeysItem]):
        total_distinct (float):
    """

    key: str
    kind: Literal["dynamic_keys"]
    label: str
    group: GetApiTracesFacetsResponse200Type0FacetsItemType2Group
    top_keys: list[GetApiTracesFacetsResponse200Type0FacetsItemType2TopKeysItem]
    total_distinct: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        kind = self.kind

        label = self.label

        group = self.group.value

        top_keys = []
        for top_keys_item_data in self.top_keys:
            top_keys_item = top_keys_item_data.to_dict()
            top_keys.append(top_keys_item)

        total_distinct = self.total_distinct

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "kind": kind,
                "label": label,
                "group": group,
                "topKeys": top_keys,
                "totalDistinct": total_distinct,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_2_top_keys_item import (
            GetApiTracesFacetsResponse200Type0FacetsItemType2TopKeysItem,
        )

        d = dict(src_dict)
        key = d.pop("key")

        kind = cast(Literal["dynamic_keys"], d.pop("kind"))
        if kind != "dynamic_keys":
            raise ValueError(f"kind must match const 'dynamic_keys', got '{kind}'")

        label = d.pop("label")

        group = GetApiTracesFacetsResponse200Type0FacetsItemType2Group(d.pop("group"))

        top_keys = []
        _top_keys = d.pop("topKeys")
        for top_keys_item_data in _top_keys:
            top_keys_item = GetApiTracesFacetsResponse200Type0FacetsItemType2TopKeysItem.from_dict(top_keys_item_data)

            top_keys.append(top_keys_item)

        total_distinct = d.pop("totalDistinct")

        get_api_traces_facets_response_200_type_0_facets_item_type_2 = cls(
            key=key,
            kind=kind,
            label=label,
            group=group,
            top_keys=top_keys,
            total_distinct=total_distinct,
        )

        get_api_traces_facets_response_200_type_0_facets_item_type_2.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item_type_2

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
