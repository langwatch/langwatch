from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_groups_body_bindings_item import PostApiGroupsBodyBindingsItem


T = TypeVar("T", bound="PostApiGroupsBody")


@_attrs_define
class PostApiGroupsBody:
    """
    Attributes:
        name (str):
        bindings (list[PostApiGroupsBodyBindingsItem] | Unset):
        member_ids (list[str] | Unset):
    """

    name: str
    bindings: list[PostApiGroupsBodyBindingsItem] | Unset = UNSET
    member_ids: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        bindings: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.bindings, Unset):
            bindings = []
            for bindings_item_data in self.bindings:
                bindings_item = bindings_item_data.to_dict()
                bindings.append(bindings_item)

        member_ids: list[str] | Unset = UNSET
        if not isinstance(self.member_ids, Unset):
            member_ids = self.member_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if bindings is not UNSET:
            field_dict["bindings"] = bindings
        if member_ids is not UNSET:
            field_dict["memberIds"] = member_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_groups_body_bindings_item import PostApiGroupsBodyBindingsItem

        d = dict(src_dict)
        name = d.pop("name")

        _bindings = d.pop("bindings", UNSET)
        bindings: list[PostApiGroupsBodyBindingsItem] | Unset = UNSET
        if _bindings is not UNSET:
            bindings = []
            for bindings_item_data in _bindings:
                bindings_item = PostApiGroupsBodyBindingsItem.from_dict(bindings_item_data)

                bindings.append(bindings_item)

        member_ids = cast(list[str], d.pop("memberIds", UNSET))

        post_api_groups_body = cls(
            name=name,
            bindings=bindings,
            member_ids=member_ids,
        )

        post_api_groups_body.additional_properties = d
        return post_api_groups_body

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
