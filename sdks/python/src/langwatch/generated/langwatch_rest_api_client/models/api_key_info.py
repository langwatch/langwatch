from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_key_info_role_bindings_item import ApiKeyInfoRoleBindingsItem


T = TypeVar("T", bound="ApiKeyInfo")


@_attrs_define
class ApiKeyInfo:
    """
    Attributes:
        id (str | Unset):
        name (str | Unset):
        description (None | str | Unset):
        created_at (datetime.datetime | Unset):
        expires_at (datetime.datetime | None | Unset):
        last_used_at (datetime.datetime | None | Unset):
        revoked_at (datetime.datetime | None | Unset):
        role_bindings (list[ApiKeyInfoRoleBindingsItem] | Unset):
    """

    id: str | Unset = UNSET
    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    expires_at: datetime.datetime | None | Unset = UNSET
    last_used_at: datetime.datetime | None | Unset = UNSET
    revoked_at: datetime.datetime | None | Unset = UNSET
    role_bindings: list[ApiKeyInfoRoleBindingsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        expires_at: None | str | Unset
        if isinstance(self.expires_at, Unset):
            expires_at = UNSET
        elif isinstance(self.expires_at, datetime.datetime):
            expires_at = self.expires_at.isoformat()
        else:
            expires_at = self.expires_at

        last_used_at: None | str | Unset
        if isinstance(self.last_used_at, Unset):
            last_used_at = UNSET
        elif isinstance(self.last_used_at, datetime.datetime):
            last_used_at = self.last_used_at.isoformat()
        else:
            last_used_at = self.last_used_at

        revoked_at: None | str | Unset
        if isinstance(self.revoked_at, Unset):
            revoked_at = UNSET
        elif isinstance(self.revoked_at, datetime.datetime):
            revoked_at = self.revoked_at.isoformat()
        else:
            revoked_at = self.revoked_at

        role_bindings: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.role_bindings, Unset):
            role_bindings = []
            for role_bindings_item_data in self.role_bindings:
                role_bindings_item = role_bindings_item_data.to_dict()
                role_bindings.append(role_bindings_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if expires_at is not UNSET:
            field_dict["expiresAt"] = expires_at
        if last_used_at is not UNSET:
            field_dict["lastUsedAt"] = last_used_at
        if revoked_at is not UNSET:
            field_dict["revokedAt"] = revoked_at
        if role_bindings is not UNSET:
            field_dict["roleBindings"] = role_bindings

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_key_info_role_bindings_item import ApiKeyInfoRoleBindingsItem

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)

        def _parse_expires_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                expires_at_type_0 = isoparse(data)

                return expires_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        expires_at = _parse_expires_at(d.pop("expiresAt", UNSET))

        def _parse_last_used_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_used_at_type_0 = isoparse(data)

                return last_used_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        last_used_at = _parse_last_used_at(d.pop("lastUsedAt", UNSET))

        def _parse_revoked_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                revoked_at_type_0 = isoparse(data)

                return revoked_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        revoked_at = _parse_revoked_at(d.pop("revokedAt", UNSET))

        _role_bindings = d.pop("roleBindings", UNSET)
        role_bindings: list[ApiKeyInfoRoleBindingsItem] | Unset = UNSET
        if _role_bindings is not UNSET:
            role_bindings = []
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

        api_key_info.additional_properties = d
        return api_key_info

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
