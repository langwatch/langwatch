from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_traces_facets_response_200_type_0_facets_item_kind import (
    GetApiTracesFacetsResponse200Type0FacetsItemKind,
)

T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItem")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItem:
    """
    Attributes:
        key (str):
        kind (GetApiTracesFacetsResponse200Type0FacetsItemKind):
        label (str):
        group (str):
    """

    key: str
    kind: GetApiTracesFacetsResponse200Type0FacetsItemKind
    label: str
    group: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        kind = self.kind.value

        label = self.label

        group = self.group

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "kind": kind,
                "label": label,
                "group": group,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        key = d.pop("key")

        kind = GetApiTracesFacetsResponse200Type0FacetsItemKind(d.pop("kind"))

        label = d.pop("label")

        group = d.pop("group")

        get_api_traces_facets_response_200_type_0_facets_item = cls(
            key=key,
            kind=kind,
            label=label,
            group=group,
        )

        get_api_traces_facets_response_200_type_0_facets_item.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item

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
