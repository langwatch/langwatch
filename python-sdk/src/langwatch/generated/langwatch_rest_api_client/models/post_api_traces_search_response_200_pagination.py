from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiTracesSearchResponse200Pagination")


@_attrs_define
class PostApiTracesSearchResponse200Pagination:
    """
    Attributes:
        total_hits (float):
        scroll_id (str | Unset):
    """

    total_hits: float
    scroll_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        total_hits = self.total_hits

        scroll_id = self.scroll_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "totalHits": total_hits,
            }
        )
        if scroll_id is not UNSET:
            field_dict["scrollId"] = scroll_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        total_hits = d.pop("totalHits")

        scroll_id = d.pop("scrollId", UNSET)

        post_api_traces_search_response_200_pagination = cls(
            total_hits=total_hits,
            scroll_id=scroll_id,
        )

        post_api_traces_search_response_200_pagination.additional_properties = d
        return post_api_traces_search_response_200_pagination

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
