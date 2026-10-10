from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiGroupsResponse200Pagination")


@_attrs_define
class GetApiGroupsResponse200Pagination:
    """
    Attributes:
        page (int):
        limit (int):
        total (int):
    """

    page: int
    limit: int
    total: int

    def to_dict(self) -> dict[str, Any]:
        page = self.page

        limit = self.limit

        total = self.total

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "page": page,
                "limit": limit,
                "total": total,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        page = d.pop("page")

        limit = d.pop("limit")

        total = d.pop("total")

        get_api_groups_response_200_pagination = cls(
            page=page,
            limit=limit,
            total=total,
        )

        return get_api_groups_response_200_pagination
