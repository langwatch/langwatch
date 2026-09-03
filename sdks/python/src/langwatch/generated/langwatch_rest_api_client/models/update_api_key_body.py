from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_api_key_body_permission_mode import UpdateApiKeyBodyPermissionMode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.update_api_key_body_bindings_item import UpdateApiKeyBodyBindingsItem


T = TypeVar("T", bound="UpdateApiKeyBody")


@_attrs_define
class UpdateApiKeyBody:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset):
        permission_mode (UpdateApiKeyBodyPermissionMode | Unset): 'all' and 'readonly' take their meaning from the
            bindings alone; 'restricted' additionally requires an explicit permissions list.
        permissions (list[str] | Unset): Restricted mode only: the exact resource:action permissions the key's CUSTOM
            bindings grant.
        bindings (list[UpdateApiKeyBodyBindingsItem] | Unset): Replaces the key's bindings outright. Whatever is
            accepted here is exactly what a subsequent GET returns.
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    permission_mode: UpdateApiKeyBodyPermissionMode | Unset = UNSET
    permissions: list[str] | Unset = UNSET
    bindings: list[UpdateApiKeyBodyBindingsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

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

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if permission_mode is not UNSET:
            field_dict["permissionMode"] = permission_mode
        if permissions is not UNSET:
            field_dict["permissions"] = permissions
        if bindings is not UNSET:
            field_dict["bindings"] = bindings

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_api_key_body_bindings_item import UpdateApiKeyBodyBindingsItem

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        _permission_mode = d.pop("permissionMode", UNSET)
        permission_mode: UpdateApiKeyBodyPermissionMode | Unset
        if isinstance(_permission_mode, Unset):
            permission_mode = UNSET
        else:
            permission_mode = UpdateApiKeyBodyPermissionMode(_permission_mode)

        permissions = cast(list[str], d.pop("permissions", UNSET))

        _bindings = d.pop("bindings", UNSET)
        bindings: list[UpdateApiKeyBodyBindingsItem] | Unset = UNSET
        if _bindings is not UNSET:
            bindings = []
            for bindings_item_data in _bindings:
                bindings_item = UpdateApiKeyBodyBindingsItem.from_dict(bindings_item_data)

                bindings.append(bindings_item)

        update_api_key_body = cls(
            name=name,
            description=description,
            permission_mode=permission_mode,
            permissions=permissions,
            bindings=bindings,
        )

        update_api_key_body.additional_properties = d
        return update_api_key_body

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
