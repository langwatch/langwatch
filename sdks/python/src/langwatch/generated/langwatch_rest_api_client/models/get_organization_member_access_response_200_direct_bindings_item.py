from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_organization_member_access_response_200_direct_bindings_item_scope_type import (
    GetOrganizationMemberAccessResponse200DirectBindingsItemScopeType,
)

T = TypeVar("T", bound="GetOrganizationMemberAccessResponse200DirectBindingsItem")


@_attrs_define
class GetOrganizationMemberAccessResponse200DirectBindingsItem:
    """
    Attributes:
        id (str):
        role (str):
        custom_role_name (None | str):
        scope_type (GetOrganizationMemberAccessResponse200DirectBindingsItemScopeType):
        scope_id (str):
        scope_name (None | str):
        permissions (list[str]):
    """

    id: str
    role: str
    custom_role_name: None | str
    scope_type: GetOrganizationMemberAccessResponse200DirectBindingsItemScopeType
    scope_id: str
    scope_name: None | str
    permissions: list[str]

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        role = self.role

        custom_role_name: None | str
        custom_role_name = self.custom_role_name

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        scope_name: None | str
        scope_name = self.scope_name

        permissions = self.permissions

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "role": role,
                "customRoleName": custom_role_name,
                "scopeType": scope_type,
                "scopeId": scope_id,
                "scopeName": scope_name,
                "permissions": permissions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        role = d.pop("role")

        def _parse_custom_role_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_role_name = _parse_custom_role_name(d.pop("customRoleName"))

        scope_type = GetOrganizationMemberAccessResponse200DirectBindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        def _parse_scope_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scope_name = _parse_scope_name(d.pop("scopeName"))

        permissions = cast(list[str], d.pop("permissions"))

        get_organization_member_access_response_200_direct_bindings_item = cls(
            id=id,
            role=role,
            custom_role_name=custom_role_name,
            scope_type=scope_type,
            scope_id=scope_id,
            scope_name=scope_name,
            permissions=permissions,
        )

        return get_organization_member_access_response_200_direct_bindings_item
