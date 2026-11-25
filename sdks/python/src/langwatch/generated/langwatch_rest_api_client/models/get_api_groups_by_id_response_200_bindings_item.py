from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_groups_by_id_response_200_bindings_item_role import GetApiGroupsByIdResponse200BindingsItemRole
from ..models.get_api_groups_by_id_response_200_bindings_item_scope_type import (
    GetApiGroupsByIdResponse200BindingsItemScopeType,
)

T = TypeVar("T", bound="GetApiGroupsByIdResponse200BindingsItem")


@_attrs_define
class GetApiGroupsByIdResponse200BindingsItem:
    """
    Attributes:
        id (str):
        role (GetApiGroupsByIdResponse200BindingsItemRole):
        custom_role_id (None | str):
        custom_role_name (None | str):
        scope_type (GetApiGroupsByIdResponse200BindingsItemScopeType):
        scope_id (str):
    """

    id: str
    role: GetApiGroupsByIdResponse200BindingsItemRole
    custom_role_id: None | str
    custom_role_name: None | str
    scope_type: GetApiGroupsByIdResponse200BindingsItemScopeType
    scope_id: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        role = self.role.value

        custom_role_id: None | str
        custom_role_id = self.custom_role_id

        custom_role_name: None | str
        custom_role_name = self.custom_role_name

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "role": role,
                "customRoleId": custom_role_id,
                "customRoleName": custom_role_name,
                "scopeType": scope_type,
                "scopeId": scope_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        role = GetApiGroupsByIdResponse200BindingsItemRole(d.pop("role"))

        def _parse_custom_role_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_role_id = _parse_custom_role_id(d.pop("customRoleId"))

        def _parse_custom_role_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_role_name = _parse_custom_role_name(d.pop("customRoleName"))

        scope_type = GetApiGroupsByIdResponse200BindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        get_api_groups_by_id_response_200_bindings_item = cls(
            id=id,
            role=role,
            custom_role_id=custom_role_id,
            custom_role_name=custom_role_name,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        return get_api_groups_by_id_response_200_bindings_item
