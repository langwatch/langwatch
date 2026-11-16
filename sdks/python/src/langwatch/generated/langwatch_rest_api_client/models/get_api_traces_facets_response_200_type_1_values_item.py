from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type1ValuesItem")


@_attrs_define
class GetApiTracesFacetsResponse200Type1ValuesItem:
    """
    Attributes:
        value (str):
        count (float):
        label (str | Unset):
    """

    value: str
    count: float
    label: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        count = self.count

        label = self.label

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "value": value,
                "count": count,
            }
        )
        if label is not UNSET:
            field_dict["label"] = label

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value")

        count = d.pop("count")

        label = d.pop("label", UNSET)

        get_api_traces_facets_response_200_type_1_values_item = cls(
            value=value,
            count=count,
            label=label,
        )

        return get_api_traces_facets_response_200_type_1_values_item
