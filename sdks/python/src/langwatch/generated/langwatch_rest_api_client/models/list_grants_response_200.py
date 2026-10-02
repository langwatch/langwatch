from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_grants_response_200_grants_item import ListGrantsResponse200GrantsItem


T = TypeVar("T", bound="ListGrantsResponse200")


@_attrs_define
class ListGrantsResponse200:
    """
    Attributes:
        grants (list[ListGrantsResponse200GrantsItem]):
        next_cursor (None | str):
    """

    grants: list[ListGrantsResponse200GrantsItem]
    next_cursor: None | str

    def to_dict(self) -> dict[str, Any]:
        grants = []
        for grants_item_data in self.grants:
            grants_item = grants_item_data.to_dict()
            grants.append(grants_item)

        next_cursor: None | str
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "grants": grants,
                "nextCursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_grants_response_200_grants_item import ListGrantsResponse200GrantsItem

        d = dict(src_dict)
        grants = []
        _grants = d.pop("grants")
        for grants_item_data in _grants:
            grants_item = ListGrantsResponse200GrantsItem.from_dict(grants_item_data)

            grants.append(grants_item)

        def _parse_next_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        list_grants_response_200 = cls(
            grants=grants,
            next_cursor=next_cursor,
        )

        return list_grants_response_200
