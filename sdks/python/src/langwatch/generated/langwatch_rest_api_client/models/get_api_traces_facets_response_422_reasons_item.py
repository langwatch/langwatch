from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_422_reasons_item_meta import (
        GetApiTracesFacetsResponse422ReasonsItemMeta,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse422ReasonsItem")


@_attrs_define
class GetApiTracesFacetsResponse422ReasonsItem:
    """
    Attributes:
        code (str):
        meta (GetApiTracesFacetsResponse422ReasonsItemMeta | Unset):
    """

    code: str
    meta: GetApiTracesFacetsResponse422ReasonsItemMeta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
            }
        )
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_422_reasons_item_meta import (
            GetApiTracesFacetsResponse422ReasonsItemMeta,
        )

        d = dict(src_dict)
        code = d.pop("code")

        _meta = d.pop("meta", UNSET)
        meta: GetApiTracesFacetsResponse422ReasonsItemMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = GetApiTracesFacetsResponse422ReasonsItemMeta.from_dict(_meta)

        get_api_traces_facets_response_422_reasons_item = cls(
            code=code,
            meta=meta,
        )

        get_api_traces_facets_response_422_reasons_item.additional_properties = d
        return get_api_traces_facets_response_422_reasons_item

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
