from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.api_key_info_role_bindings_item_role import ApiKeyInfoRoleBindingsItemRole
from ..models.api_key_info_role_bindings_item_scope_type import ApiKeyInfoRoleBindingsItemScopeType

T = TypeVar("T", bound="ApiKeyInfoRoleBindingsItem")


@_attrs_define
class ApiKeyInfoRoleBindingsItem:
    """
    Attributes:
        id (str):
        role (ApiKeyInfoRoleBindingsItemRole):
        scope_type (ApiKeyInfoRoleBindingsItemScopeType):
        scope_id (str):
    """

    id: str
    role: ApiKeyInfoRoleBindingsItemRole
    scope_type: ApiKeyInfoRoleBindingsItemScopeType
    scope_id: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        role = self.role.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "role": role,
                "scopeType": scope_type,
                "scopeId": scope_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        role = ApiKeyInfoRoleBindingsItemRole(d.pop("role"))

        scope_type = ApiKeyInfoRoleBindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        api_key_info_role_bindings_item = cls(
            id=id,
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        return api_key_info_role_bindings_item
