from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_role_bindings_response_200_bindings_item import ListRoleBindingsResponse200BindingsItem


T = TypeVar("T", bound="ListRoleBindingsResponse200")


@_attrs_define
class ListRoleBindingsResponse200:
    """
    Attributes:
        bindings (list[ListRoleBindingsResponse200BindingsItem]):
        total_count (float):
    """

    bindings: list[ListRoleBindingsResponse200BindingsItem]
    total_count: float

    def to_dict(self) -> dict[str, Any]:
        bindings = []
        for bindings_item_data in self.bindings:
            bindings_item = bindings_item_data.to_dict()
            bindings.append(bindings_item)

        total_count = self.total_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "bindings": bindings,
                "totalCount": total_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_role_bindings_response_200_bindings_item import ListRoleBindingsResponse200BindingsItem

        d = dict(src_dict)
        bindings = []
        _bindings = d.pop("bindings")
        for bindings_item_data in _bindings:
            bindings_item = ListRoleBindingsResponse200BindingsItem.from_dict(bindings_item_data)

            bindings.append(bindings_item)

        total_count = d.pop("totalCount")

        list_role_bindings_response_200 = cls(
            bindings=bindings,
            total_count=total_count,
        )

        return list_role_bindings_response_200
