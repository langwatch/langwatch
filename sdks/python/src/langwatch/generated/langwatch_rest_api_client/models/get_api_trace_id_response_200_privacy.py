from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200Privacy")


@_attrs_define
class GetApiTraceIdResponse200Privacy:
    """
    Attributes:
        dropped_categories (list[str] | Unset):
    """

    dropped_categories: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        dropped_categories: list[str] | Unset = UNSET
        if not isinstance(self.dropped_categories, Unset):
            dropped_categories = self.dropped_categories

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if dropped_categories is not UNSET:
            field_dict["droppedCategories"] = dropped_categories

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        dropped_categories = cast(list[str], d.pop("droppedCategories", UNSET))

        get_api_trace_id_response_200_privacy = cls(
            dropped_categories=dropped_categories,
        )

        get_api_trace_id_response_200_privacy.additional_properties = d
        return get_api_trace_id_response_200_privacy

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
