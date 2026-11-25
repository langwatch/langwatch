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
        skipped (float | Unset): Number of traces dropped from this page because they failed to serialize. Present only
            when non-zero, so a caller can tell that traces.length is below the page size for a reason other than reaching
            the end of the result set.
        updated_through (float | Unset): Only when dateField is 'updated'. Epoch milliseconds: the upper bound this
            scroll actually covered, which is at or before the endDate you asked for. The scroll reads every trace as of the
            moment it started, so anything written after that instant belongs to the next pull. Start your next incremental
            pull from this value — resuming from the endDate you requested would step over the difference and lose those
            traces. The bound is inclusive on both sides, so a trace last written at exactly this millisecond arrives in
            this pull and again in the next one: pulls are at-least-once, and applying them idempotently is what keeps that
            from becoming a duplicate.
    """

    total_hits: float
    scroll_id: str | Unset = UNSET
    skipped: float | Unset = UNSET
    updated_through: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        total_hits = self.total_hits

        scroll_id = self.scroll_id

        skipped = self.skipped

        updated_through = self.updated_through

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "totalHits": total_hits,
            }
        )
        if scroll_id is not UNSET:
            field_dict["scrollId"] = scroll_id
        if skipped is not UNSET:
            field_dict["skipped"] = skipped
        if updated_through is not UNSET:
            field_dict["updatedThrough"] = updated_through

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        total_hits = d.pop("totalHits")

        scroll_id = d.pop("scrollId", UNSET)

        skipped = d.pop("skipped", UNSET)

        updated_through = d.pop("updatedThrough", UNSET)

        post_api_traces_search_response_200_pagination = cls(
            total_hits=total_hits,
            scroll_id=scroll_id,
            skipped=skipped,
            updated_through=updated_through,
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
