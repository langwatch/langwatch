from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_staff_access_organizations_response_200_items_item import (
        ListStaffAccessOrganizationsResponse200ItemsItem,
    )


T = TypeVar("T", bound="ListStaffAccessOrganizationsResponse200")


@_attrs_define
class ListStaffAccessOrganizationsResponse200:
    """
    Attributes:
        items (list[ListStaffAccessOrganizationsResponse200ItemsItem]):
        total (int):
        truncated (bool):
        next_cursor (None | str):
    """

    items: list[ListStaffAccessOrganizationsResponse200ItemsItem]
    total: int
    truncated: bool
    next_cursor: None | str

    def to_dict(self) -> dict[str, Any]:
        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        total = self.total

        truncated = self.truncated

        next_cursor: None | str
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "items": items,
                "total": total,
                "truncated": truncated,
                "nextCursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_staff_access_organizations_response_200_items_item import (
            ListStaffAccessOrganizationsResponse200ItemsItem,
        )

        d = dict(src_dict)
        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = ListStaffAccessOrganizationsResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        total = d.pop("total")

        truncated = d.pop("truncated")

        def _parse_next_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        list_staff_access_organizations_response_200 = cls(
            items=items,
            total=total,
            truncated=truncated,
            next_cursor=next_cursor,
        )

        return list_staff_access_organizations_response_200
