from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_role_binding_response_200_role import UpdateRoleBindingResponse200Role
from ..models.update_role_binding_response_200_scope_type import UpdateRoleBindingResponse200ScopeType

if TYPE_CHECKING:
    from ..models.update_role_binding_response_200_principal import UpdateRoleBindingResponse200Principal


T = TypeVar("T", bound="UpdateRoleBindingResponse200")


@_attrs_define
class UpdateRoleBindingResponse200:
    """
    Attributes:
        id (str):
        principal (UpdateRoleBindingResponse200Principal):
        role (UpdateRoleBindingResponse200Role):
        custom_role_id (None | str):
        custom_role_name (None | str):
        scope_type (UpdateRoleBindingResponse200ScopeType):
        scope_id (str):
        scope_name (None | str):
        created_at (str):
    """

    id: str
    principal: UpdateRoleBindingResponse200Principal
    role: UpdateRoleBindingResponse200Role
    custom_role_id: None | str
    custom_role_name: None | str
    scope_type: UpdateRoleBindingResponse200ScopeType
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
        from ..models.update_role_binding_response_200_principal import UpdateRoleBindingResponse200Principal

        d = dict(src_dict)
        id = d.pop("id")

        principal = UpdateRoleBindingResponse200Principal.from_dict(d.pop("principal"))

        role = UpdateRoleBindingResponse200Role(d.pop("role"))

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

        scope_type = UpdateRoleBindingResponse200ScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        def _parse_scope_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scope_name = _parse_scope_name(d.pop("scopeName"))

        created_at = d.pop("createdAt")

        update_role_binding_response_200 = cls(
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

        update_role_binding_response_200.additional_properties = d
        return update_role_binding_response_200

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
