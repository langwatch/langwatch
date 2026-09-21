from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_groups_body_bindings_item_role import PostApiGroupsBodyBindingsItemRole
from ..models.post_api_groups_body_bindings_item_scope_type import PostApiGroupsBodyBindingsItemScopeType
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGroupsBodyBindingsItem")


@_attrs_define
class PostApiGroupsBodyBindingsItem:
    """
    Attributes:
        role (PostApiGroupsBodyBindingsItemRole):
        scope_type (PostApiGroupsBodyBindingsItemScopeType):
        scope_id (str):
        custom_role_id (str | Unset):
    """

    role: PostApiGroupsBodyBindingsItemRole
    scope_type: PostApiGroupsBodyBindingsItemScopeType
    scope_id: str
    custom_role_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        custom_role_id = self.custom_role_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "role": role,
                "scopeType": scope_type,
                "scopeId": scope_id,
            }
        )
        if custom_role_id is not UNSET:
            field_dict["customRoleId"] = custom_role_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = PostApiGroupsBodyBindingsItemRole(d.pop("role"))

        scope_type = PostApiGroupsBodyBindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        custom_role_id = d.pop("customRoleId", UNSET)

        post_api_groups_body_bindings_item = cls(
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
            custom_role_id=custom_role_id,
        )

        post_api_groups_body_bindings_item.additional_properties = d
        return post_api_groups_body_bindings_item

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
