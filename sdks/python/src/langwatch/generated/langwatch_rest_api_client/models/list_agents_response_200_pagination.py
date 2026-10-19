from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListAgentsResponse200Pagination")


@_attrs_define
class ListAgentsResponse200Pagination:
    """
    Attributes:
        page (int):
        limit (int):
        total (int):
        total_pages (int):
    """

    page: int
    limit: int
    total: int
    total_pages: int

    def to_dict(self) -> dict[str, Any]:
        page = self.page

        limit = self.limit

        total = self.total

        total_pages = self.total_pages

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": total_pages,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        page = d.pop("page")

        limit = d.pop("limit")

        total = d.pop("total")

        total_pages = d.pop("totalPages")

        list_agents_response_200_pagination = cls(
            page=page,
            limit=limit,
            total=total,
            total_pages=total_pages,
        )

        return list_agents_response_200_pagination
