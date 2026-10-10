from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.create_grant_response_201_status import CreateGrantResponse201Status

if TYPE_CHECKING:
    from ..models.create_grant_response_201_principal import CreateGrantResponse201Principal
    from ..models.create_grant_response_201_role import CreateGrantResponse201Role
    from ..models.create_grant_response_201_scope import CreateGrantResponse201Scope


T = TypeVar("T", bound="CreateGrantResponse201")


@_attrs_define
class CreateGrantResponse201:
    """
    Attributes:
        id (str):
        principal (CreateGrantResponse201Principal):
        role (CreateGrantResponse201Role):
        scope (CreateGrantResponse201Scope):
        status (CreateGrantResponse201Status):
        expires_at (datetime.datetime | None):
        created_at (datetime.datetime):
    """

    id: str
    principal: CreateGrantResponse201Principal
    role: CreateGrantResponse201Role
    scope: CreateGrantResponse201Scope
    status: CreateGrantResponse201Status
    expires_at: datetime.datetime | None
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        principal = self.principal.to_dict()

        role = self.role.to_dict()

        scope = self.scope.to_dict()

        status = self.status.value

        expires_at: None | str
        if isinstance(self.expires_at, datetime.datetime):
            expires_at = self.expires_at.isoformat()
        else:
            expires_at = self.expires_at

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "principal": principal,
                "role": role,
                "scope": scope,
                "status": status,
                "expiresAt": expires_at,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_grant_response_201_principal import CreateGrantResponse201Principal
        from ..models.create_grant_response_201_role import CreateGrantResponse201Role
        from ..models.create_grant_response_201_scope import CreateGrantResponse201Scope

        d = dict(src_dict)
        id = d.pop("id")

        principal = CreateGrantResponse201Principal.from_dict(d.pop("principal"))

        role = CreateGrantResponse201Role.from_dict(d.pop("role"))

        scope = CreateGrantResponse201Scope.from_dict(d.pop("scope"))

        status = CreateGrantResponse201Status(d.pop("status"))

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

        created_at = isoparse(d.pop("createdAt"))

        create_grant_response_201 = cls(
            id=id,
            principal=principal,
            role=role,
            scope=scope,
            status=status,
            expires_at=expires_at,
            created_at=created_at,
        )

        return create_grant_response_201
