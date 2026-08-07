from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.api_key_info_role_bindings_item_role import ApiKeyInfoRoleBindingsItemRole
from ..models.api_key_info_role_bindings_item_scope_type import ApiKeyInfoRoleBindingsItemScopeType
from ..types import UNSET, Unset

T = TypeVar("T", bound="ApiKeyInfoRoleBindingsItem")


@_attrs_define
class ApiKeyInfoRoleBindingsItem:
    """
    Attributes:
        id (str | Unset):
        role (ApiKeyInfoRoleBindingsItemRole | Unset):
        scope_type (ApiKeyInfoRoleBindingsItemScopeType | Unset):
        scope_id (str | Unset):
    """

    id: str | Unset = UNSET
    role: ApiKeyInfoRoleBindingsItemRole | Unset = UNSET
    scope_type: ApiKeyInfoRoleBindingsItemScopeType | Unset = UNSET
    scope_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        role: str | Unset = UNSET
        if not isinstance(self.role, Unset):
            role = self.role.value

        scope_type: str | Unset = UNSET
        if not isinstance(self.scope_type, Unset):
            scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if role is not UNSET:
            field_dict["role"] = role
        if scope_type is not UNSET:
            field_dict["scopeType"] = scope_type
        if scope_id is not UNSET:
            field_dict["scopeId"] = scope_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id", UNSET)

        _role = d.pop("role", UNSET)
        role: ApiKeyInfoRoleBindingsItemRole | Unset
        if isinstance(_role, Unset):
            role = UNSET
        else:
            role = ApiKeyInfoRoleBindingsItemRole(_role)

        _scope_type = d.pop("scopeType", UNSET)
        scope_type: ApiKeyInfoRoleBindingsItemScopeType | Unset
        if isinstance(_scope_type, Unset):
            scope_type = UNSET
        else:
            scope_type = ApiKeyInfoRoleBindingsItemScopeType(_scope_type)

        scope_id = d.pop("scopeId", UNSET)

        api_key_info_role_bindings_item = cls(
            id=id,
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        api_key_info_role_bindings_item.additional_properties = d
        return api_key_info_role_bindings_item

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
