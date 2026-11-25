from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.create_role_binding_response_201_role import CreateRoleBindingResponse201Role
from ..models.create_role_binding_response_201_scope_type import CreateRoleBindingResponse201ScopeType

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
        created_at (datetime.datetime):
        expires_at (datetime.datetime | None):
    """

    id: str
    principal: CreateRoleBindingResponse201Principal
    role: CreateRoleBindingResponse201Role
    custom_role_id: None | str
    custom_role_name: None | str
    scope_type: CreateRoleBindingResponse201ScopeType
    scope_id: str
    scope_name: None | str
    created_at: datetime.datetime
    expires_at: datetime.datetime | None

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

        created_at = self.created_at.isoformat()

        expires_at: None | str
        if isinstance(self.expires_at, datetime.datetime):
            expires_at = self.expires_at.isoformat()
        else:
            expires_at = self.expires_at

        field_dict: dict[str, Any] = {}

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
                "expiresAt": expires_at,
            }
        )

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

        created_at = isoparse(d.pop("createdAt"))

        def _parse_expires_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                expires_at_type_0 = isoparse(data)

                return expires_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        expires_at = _parse_expires_at(d.pop("expiresAt"))

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
            expires_at=expires_at,
        )

        return create_role_binding_response_201
