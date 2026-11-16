from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200Privacy")


@_attrs_define
class GetApiTraceIdResponse200Privacy:
    """
    Attributes:
        dropped_categories (list[str] | Unset):
    """

    dropped_categories: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        dropped_categories: list[str] | Unset = UNSET
        if not isinstance(self.dropped_categories, Unset):
            dropped_categories = self.dropped_categories

        field_dict: dict[str, Any] = {}

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

        return get_api_trace_id_response_200_privacy
