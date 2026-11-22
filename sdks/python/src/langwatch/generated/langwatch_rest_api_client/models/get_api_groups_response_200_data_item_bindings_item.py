from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_groups_response_200_data_item_bindings_item_role import (
    GetApiGroupsResponse200DataItemBindingsItemRole,
)
from ..models.get_api_groups_response_200_data_item_bindings_item_scope_type import (
    GetApiGroupsResponse200DataItemBindingsItemScopeType,
)

T = TypeVar("T", bound="GetApiGroupsResponse200DataItemBindingsItem")


@_attrs_define
class GetApiGroupsResponse200DataItemBindingsItem:
    """
    Attributes:
        id (str):
        role (GetApiGroupsResponse200DataItemBindingsItemRole):
        custom_role_id (None | str):
        custom_role_name (None | str):
        scope_type (GetApiGroupsResponse200DataItemBindingsItemScopeType):
        scope_id (str):
    """

    id: str
    role: GetApiGroupsResponse200DataItemBindingsItemRole
    custom_role_id: None | str
    custom_role_name: None | str
    scope_type: GetApiGroupsResponse200DataItemBindingsItemScopeType
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

        role = GetApiGroupsResponse200DataItemBindingsItemRole(d.pop("role"))

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

        scope_type = GetApiGroupsResponse200DataItemBindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        get_api_groups_response_200_data_item_bindings_item = cls(
            id=id,
            role=role,
            custom_role_id=custom_role_id,
            custom_role_name=custom_role_name,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        return get_api_groups_response_200_data_item_bindings_item
