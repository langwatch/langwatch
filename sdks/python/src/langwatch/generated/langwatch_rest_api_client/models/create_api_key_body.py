from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_api_key_body_key_type import CreateApiKeyBodyKeyType
from ..models.create_api_key_body_permission_mode import CreateApiKeyBodyPermissionMode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_api_key_body_bindings_item import CreateApiKeyBodyBindingsItem


T = TypeVar("T", bound="CreateApiKeyBody")


@_attrs_define
class CreateApiKeyBody:
    """
    Attributes:
        name (str): Human-readable name for this key
        key_type (CreateApiKeyBodyKeyType | Unset): A personal key acts as the user who created it and needs explicit
            bindings. A service key is not tied to a user. Default: CreateApiKeyBodyKeyType.PERSONAL.
        description (str | Unset):
        expires_at (str | Unset): ISO 8601 timestamp after which the key stops working
        assigned_to_user_id (str | Unset): Organization admins only: the member who owns the key and whose access caps
            it. Defaults to the caller.
        permission_mode (CreateApiKeyBodyPermissionMode | Unset): 'all' and 'readonly' take their meaning from the
            bindings alone; 'restricted' additionally requires an explicit permissions list. Default:
            CreateApiKeyBodyPermissionMode.ALL.
        permissions (list[str] | Unset): Restricted mode only: the exact resource:action permissions the key's CUSTOM
            bindings grant.
        bindings (list[CreateApiKeyBodyBindingsItem] | Unset): What this key may do, and where. Required for a personal
            key.
        project_ids (list[str] | Unset): Service keys only: restricts the key to these projects
    """

    name: str
    key_type: CreateApiKeyBodyKeyType | Unset = CreateApiKeyBodyKeyType.PERSONAL
    description: str | Unset = UNSET
    expires_at: str | Unset = UNSET
    assigned_to_user_id: str | Unset = UNSET
    permission_mode: CreateApiKeyBodyPermissionMode | Unset = CreateApiKeyBodyPermissionMode.ALL
    permissions: list[str] | Unset = UNSET
    bindings: list[CreateApiKeyBodyBindingsItem] | Unset = UNSET
    project_ids: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        key_type: str | Unset = UNSET
        if not isinstance(self.key_type, Unset):
            key_type = self.key_type.value

        description = self.description

        expires_at = self.expires_at

        assigned_to_user_id = self.assigned_to_user_id

        permission_mode: str | Unset = UNSET
        if not isinstance(self.permission_mode, Unset):
            permission_mode = self.permission_mode.value

        permissions: list[str] | Unset = UNSET
        if not isinstance(self.permissions, Unset):
            permissions = self.permissions

        bindings: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.bindings, Unset):
            bindings = []
            for bindings_item_data in self.bindings:
                bindings_item = bindings_item_data.to_dict()
                bindings.append(bindings_item)

        project_ids: list[str] | Unset = UNSET
        if not isinstance(self.project_ids, Unset):
            project_ids = self.project_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if key_type is not UNSET:
            field_dict["keyType"] = key_type
        if description is not UNSET:
            field_dict["description"] = description
        if expires_at is not UNSET:
            field_dict["expiresAt"] = expires_at
        if assigned_to_user_id is not UNSET:
            field_dict["assignedToUserId"] = assigned_to_user_id
        if permission_mode is not UNSET:
            field_dict["permissionMode"] = permission_mode
        if permissions is not UNSET:
            field_dict["permissions"] = permissions
        if bindings is not UNSET:
            field_dict["bindings"] = bindings
        if project_ids is not UNSET:
            field_dict["projectIds"] = project_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_api_key_body_bindings_item import CreateApiKeyBodyBindingsItem

        d = dict(src_dict)
        name = d.pop("name")

        _key_type = d.pop("keyType", UNSET)
        key_type: CreateApiKeyBodyKeyType | Unset
        if isinstance(_key_type, Unset):
            key_type = UNSET
        else:
            key_type = CreateApiKeyBodyKeyType(_key_type)

        description = d.pop("description", UNSET)

        expires_at = d.pop("expiresAt", UNSET)

        assigned_to_user_id = d.pop("assignedToUserId", UNSET)

        _permission_mode = d.pop("permissionMode", UNSET)
        permission_mode: CreateApiKeyBodyPermissionMode | Unset
        if isinstance(_permission_mode, Unset):
            permission_mode = UNSET
        else:
            permission_mode = CreateApiKeyBodyPermissionMode(_permission_mode)

        permissions = cast(list[str], d.pop("permissions", UNSET))

        _bindings = d.pop("bindings", UNSET)
        bindings: list[CreateApiKeyBodyBindingsItem] | Unset = UNSET
        if _bindings is not UNSET:
            bindings = []
            for bindings_item_data in _bindings:
                bindings_item = CreateApiKeyBodyBindingsItem.from_dict(bindings_item_data)

                bindings.append(bindings_item)

        project_ids = cast(list[str], d.pop("projectIds", UNSET))

        create_api_key_body = cls(
            name=name,
            key_type=key_type,
            description=description,
            expires_at=expires_at,
            assigned_to_user_id=assigned_to_user_id,
            permission_mode=permission_mode,
            permissions=permissions,
            bindings=bindings,
            project_ids=project_ids,
        )

        create_api_key_body.additional_properties = d
        return create_api_key_body

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
