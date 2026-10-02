from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.update_api_key_response_200_role_bindings_item_role import UpdateApiKeyResponse200RoleBindingsItemRole
from ..models.update_api_key_response_200_role_bindings_item_scope_type import (
    UpdateApiKeyResponse200RoleBindingsItemScopeType,
)

T = TypeVar("T", bound="UpdateApiKeyResponse200RoleBindingsItem")


@_attrs_define
class UpdateApiKeyResponse200RoleBindingsItem:
    """
    Attributes:
        id (str):
        role (UpdateApiKeyResponse200RoleBindingsItemRole):
        scope_type (UpdateApiKeyResponse200RoleBindingsItemScopeType):
        scope_id (str):
    """

    id: str
    role: UpdateApiKeyResponse200RoleBindingsItemRole
    scope_type: UpdateApiKeyResponse200RoleBindingsItemScopeType
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

        role = UpdateApiKeyResponse200RoleBindingsItemRole(d.pop("role"))

        scope_type = UpdateApiKeyResponse200RoleBindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        update_api_key_response_200_role_bindings_item = cls(
            id=id,
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        return update_api_key_response_200_role_bindings_item
