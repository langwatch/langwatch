from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.api_key_info_role_bindings_item import ApiKeyInfoRoleBindingsItem


T = TypeVar("T", bound="ApiKeyInfo")


@_attrs_define
class ApiKeyInfo:
    """
    Attributes:
        id (str):
        name (str):
        description (None | str):
        created_at (datetime.datetime):
        expires_at (datetime.datetime | None):
        last_used_at (datetime.datetime | None):
        revoked_at (datetime.datetime | None):
        role_bindings (list[ApiKeyInfoRoleBindingsItem]):
    """

    id: str
    name: str
    description: None | str
    created_at: datetime.datetime
    expires_at: datetime.datetime | None
    last_used_at: datetime.datetime | None
    revoked_at: datetime.datetime | None
    role_bindings: list[ApiKeyInfoRoleBindingsItem]

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        description: None | str
        description = self.description

        created_at = self.created_at.isoformat()

        expires_at: None | str
        if isinstance(self.expires_at, datetime.datetime):
            expires_at = self.expires_at.isoformat()
        else:
            expires_at = self.expires_at

        last_used_at: None | str
        if isinstance(self.last_used_at, datetime.datetime):
            last_used_at = self.last_used_at.isoformat()
        else:
            last_used_at = self.last_used_at

        revoked_at: None | str
        if isinstance(self.revoked_at, datetime.datetime):
            revoked_at = self.revoked_at.isoformat()
        else:
            revoked_at = self.revoked_at

        role_bindings = []
        for role_bindings_item_data in self.role_bindings:
            role_bindings_item = role_bindings_item_data.to_dict()
            role_bindings.append(role_bindings_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "description": description,
                "createdAt": created_at,
                "expiresAt": expires_at,
                "lastUsedAt": last_used_at,
                "revokedAt": revoked_at,
                "roleBindings": role_bindings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_key_info_role_bindings_item import ApiKeyInfoRoleBindingsItem

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

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

        def _parse_last_used_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_used_at_type_0 = isoparse(data)

                return last_used_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_used_at = _parse_last_used_at(d.pop("lastUsedAt"))

        def _parse_revoked_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                revoked_at_type_0 = isoparse(data)

                return revoked_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        revoked_at = _parse_revoked_at(d.pop("revokedAt"))

        role_bindings = []
        _role_bindings = d.pop("roleBindings")
        for role_bindings_item_data in _role_bindings:
            role_bindings_item = ApiKeyInfoRoleBindingsItem.from_dict(role_bindings_item_data)

            role_bindings.append(role_bindings_item)

        api_key_info = cls(
            id=id,
            name=name,
            description=description,
            created_at=created_at,
            expires_at=expires_at,
            last_used_at=last_used_at,
            revoked_at=revoked_at,
            role_bindings=role_bindings,
        )

        return api_key_info
