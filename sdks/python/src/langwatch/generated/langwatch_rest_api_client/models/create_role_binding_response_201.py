from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_role_binding_response_201_role import CreateRoleBindingResponse201Role
from ..models.create_role_binding_response_201_scope_type import CreateRoleBindingResponse201ScopeType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_role_binding_response_201_principal import CreateRoleBindingResponse201Principal


T = TypeVar("T", bound="CreateRoleBindingResponse201")


@_attrs_define
class CreateRoleBindingResponse201:
    """
    Attributes:
        id (str):
        principal (CreateRoleBindingResponse201Principal):
        role (CreateRoleBindingResponse201Role):
        custom_role_id (None | str):
        custom_role_name (None | str):
        scope_type (CreateRoleBindingResponse201ScopeType):
        scope_id (str):
        scope_name (None | str):
        created_at (str):
        has_legacy_access_notice (bool | Unset):
    """

    id: str
    principal: CreateRoleBindingResponse201Principal
    role: CreateRoleBindingResponse201Role
    custom_role_id: None | str
    custom_role_name: None | str
    scope_type: CreateRoleBindingResponse201ScopeType
    scope_id: str
    scope_name: None | str
    created_at: str
    has_legacy_access_notice: bool | Unset = UNSET
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

        has_legacy_access_notice = self.has_legacy_access_notice

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
        if has_legacy_access_notice is not UNSET:
            field_dict["hasLegacyAccessNotice"] = has_legacy_access_notice

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_role_binding_response_201_principal import CreateRoleBindingResponse201Principal

        d = dict(src_dict)
        id = d.pop("id")

        principal = CreateRoleBindingResponse201Principal.from_dict(d.pop("principal"))

        role = CreateRoleBindingResponse201Role(d.pop("role"))

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

        scope_type = CreateRoleBindingResponse201ScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        def _parse_scope_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scope_name = _parse_scope_name(d.pop("scopeName"))

        created_at = d.pop("createdAt")

        has_legacy_access_notice = d.pop("hasLegacyAccessNotice", UNSET)

        create_role_binding_response_201 = cls(
            id=id,
            principal=principal,
            role=role,
            custom_role_id=custom_role_id,
            custom_role_name=custom_role_name,
            scope_type=scope_type,
            scope_id=scope_id,
            scope_name=scope_name,
            created_at=created_at,
            has_legacy_access_notice=has_legacy_access_notice,
        )

        create_role_binding_response_201.additional_properties = d
        return create_role_binding_response_201

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
