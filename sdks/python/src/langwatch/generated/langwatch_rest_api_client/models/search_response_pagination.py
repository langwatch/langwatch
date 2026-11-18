from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SearchResponsePagination")


@_attrs_define
class SearchResponsePagination:
    """
    Attributes:
        total_hits (float):
        scroll_id (None | str | Unset):
    """

    total_hits: float
    scroll_id: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        total_hits = self.total_hits

        scroll_id: None | str | Unset
        if isinstance(self.scroll_id, Unset):
            scroll_id = UNSET
        else:
            scroll_id = self.scroll_id

        field_dict: dict[str, Any] = {}

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

        def _parse_scroll_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        scroll_id = _parse_scroll_id(d.pop("scrollId", UNSET))

        search_response_pagination = cls(
            total_hits=total_hits,
            scroll_id=scroll_id,
        )

        return search_response_pagination
