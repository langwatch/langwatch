from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.list_role_bindings_response_200_bindings_item_role import ListRoleBindingsResponse200BindingsItemRole
from ..models.list_role_bindings_response_200_bindings_item_scope_type import (
    ListRoleBindingsResponse200BindingsItemScopeType,
)

if TYPE_CHECKING:
    from ..models.list_role_bindings_response_200_bindings_item_principal import (
        ListRoleBindingsResponse200BindingsItemPrincipal,
    )


T = TypeVar("T", bound="ListRoleBindingsResponse200BindingsItem")


@_attrs_define
class ListRoleBindingsResponse200BindingsItem:
    """
    Attributes:
        id (str):
        principal (ListRoleBindingsResponse200BindingsItemPrincipal):
        role (ListRoleBindingsResponse200BindingsItemRole):
        custom_role_id (None | str):
        custom_role_name (None | str):
        scope_type (ListRoleBindingsResponse200BindingsItemScopeType):
        scope_id (str):
        scope_name (None | str):
        created_at (str):
    """

    id: str
    principal: ListRoleBindingsResponse200BindingsItemPrincipal
    role: ListRoleBindingsResponse200BindingsItemRole
    custom_role_id: None | str
    custom_role_name: None | str
    scope_type: ListRoleBindingsResponse200BindingsItemScopeType
    scope_id: str
    scope_name: None | str
    created_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        principal = self.principal.to_dict()

        role = self.role.value

        custom_role_id: None | str
        custom_role_id = self.custom_role_id

        custom_role_name: None | str
        custom_role_name = self.custom_role_name

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        scope_name: None | str
        scope_name = self.scope_name

        created_at = self.created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "principal": principal,
                "role": role,
                "customRoleId": custom_role_id,
                "customRoleName": custom_role_name,
                "scopeType": scope_type,
                "scopeId": scope_id,
                "scopeName": scope_name,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_role_bindings_response_200_bindings_item_principal import (
            ListRoleBindingsResponse200BindingsItemPrincipal,
        )

        d = dict(src_dict)
        id = d.pop("id")

        principal = ListRoleBindingsResponse200BindingsItemPrincipal.from_dict(d.pop("principal"))

        role = ListRoleBindingsResponse200BindingsItemRole(d.pop("role"))

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

        scope_type = ListRoleBindingsResponse200BindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        def _parse_scope_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scope_name = _parse_scope_name(d.pop("scopeName"))

        created_at = d.pop("createdAt")

        list_role_bindings_response_200_bindings_item = cls(
            id=id,
            principal=principal,
            role=role,
            custom_role_id=custom_role_id,
            custom_role_name=custom_role_name,
            scope_type=scope_type,
            scope_id=scope_id,
            scope_name=scope_name,
            created_at=created_at,
        )

        list_role_bindings_response_200_bindings_item.additional_properties = d
        return list_role_bindings_response_200_bindings_item

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
