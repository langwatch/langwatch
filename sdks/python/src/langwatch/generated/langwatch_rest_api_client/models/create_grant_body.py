from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_grant_body_principal import CreateGrantBodyPrincipal
    from ..models.create_grant_body_scope import CreateGrantBodyScope


T = TypeVar("T", bound="CreateGrantBody")


@_attrs_define
class CreateGrantBody:
    """
    Attributes:
        principal (CreateGrantBodyPrincipal):
        role_id (str):
        scope (CreateGrantBodyScope):
        expires_at (datetime.datetime | Unset):
    """

    principal: CreateGrantBodyPrincipal
    role_id: str
    scope: CreateGrantBodyScope
    expires_at: datetime.datetime | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        principal = self.principal.to_dict()

        role_id = self.role_id

        scope = self.scope.to_dict()

        expires_at: str | Unset = UNSET
        if not isinstance(self.expires_at, Unset):
            expires_at = self.expires_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "principal": principal,
                "roleId": role_id,
                "scope": scope,
            }
        )
        if expires_at is not UNSET:
            field_dict["expiresAt"] = expires_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_grant_body_principal import CreateGrantBodyPrincipal
        from ..models.create_grant_body_scope import CreateGrantBodyScope

        d = dict(src_dict)
        principal = CreateGrantBodyPrincipal.from_dict(d.pop("principal"))

        role_id = d.pop("roleId")

        scope = CreateGrantBodyScope.from_dict(d.pop("scope"))

        _expires_at = d.pop("expiresAt", UNSET)
        expires_at: datetime.datetime | Unset
        if isinstance(_expires_at, Unset):
            expires_at = UNSET
        else:
            expires_at = isoparse(_expires_at)

        create_grant_body = cls(
            principal=principal,
            role_id=role_id,
            scope=scope,
            expires_at=expires_at,
        )

        return create_grant_body
