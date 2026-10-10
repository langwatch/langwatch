from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.update_grant_response_200_status import UpdateGrantResponse200Status

if TYPE_CHECKING:
    from ..models.update_grant_response_200_principal import UpdateGrantResponse200Principal
    from ..models.update_grant_response_200_role import UpdateGrantResponse200Role
    from ..models.update_grant_response_200_scope import UpdateGrantResponse200Scope


T = TypeVar("T", bound="UpdateGrantResponse200")


@_attrs_define
class UpdateGrantResponse200:
    """
    Attributes:
        id (str):
        principal (UpdateGrantResponse200Principal):
        role (UpdateGrantResponse200Role):
        scope (UpdateGrantResponse200Scope):
        status (UpdateGrantResponse200Status):
        expires_at (datetime.datetime | None):
        created_at (datetime.datetime):
    """

    id: str
    principal: UpdateGrantResponse200Principal
    role: UpdateGrantResponse200Role
    scope: UpdateGrantResponse200Scope
    status: UpdateGrantResponse200Status
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
        from ..models.update_grant_response_200_principal import UpdateGrantResponse200Principal
        from ..models.update_grant_response_200_role import UpdateGrantResponse200Role
        from ..models.update_grant_response_200_scope import UpdateGrantResponse200Scope

        d = dict(src_dict)
        id = d.pop("id")

        principal = UpdateGrantResponse200Principal.from_dict(d.pop("principal"))

        role = UpdateGrantResponse200Role.from_dict(d.pop("role"))

        scope = UpdateGrantResponse200Scope.from_dict(d.pop("scope"))

        status = UpdateGrantResponse200Status(d.pop("status"))

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

        update_grant_response_200 = cls(
            id=id,
            principal=principal,
            role=role,
            scope=scope,
            status=status,
            expires_at=expires_at,
            created_at=created_at,
        )

        return update_grant_response_200
