from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiExperimentsResponse200Pagination")


@_attrs_define
class GetApiExperimentsResponse200Pagination:
    """
    Attributes:
        page (float):
        page_size (float):
        total_hits (float):
        has_more (bool):
    """

    page: float
    page_size: float
    total_hits: float
    has_more: bool

    def to_dict(self) -> dict[str, Any]:
        page = self.page

        page_size = self.page_size

        total_hits = self.total_hits

        has_more = self.has_more

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "page": page,
                "pageSize": page_size,
                "totalHits": total_hits,
                "hasMore": has_more,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        page = d.pop("page")

        page_size = d.pop("pageSize")

        total_hits = d.pop("totalHits")

        has_more = d.pop("hasMore")

        get_api_experiments_response_200_pagination = cls(
            page=page,
            page_size=page_size,
            total_hits=total_hits,
            has_more=has_more,
        )

        return get_api_experiments_response_200_pagination
