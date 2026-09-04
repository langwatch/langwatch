from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_api_key_response_200_bindings_item_role import UpdateApiKeyResponse200BindingsItemRole
from ..models.update_api_key_response_200_bindings_item_scope_type import UpdateApiKeyResponse200BindingsItemScopeType
from ..types import UNSET, Unset

T = TypeVar("T", bound="UpdateApiKeyResponse200BindingsItem")


@_attrs_define
class UpdateApiKeyResponse200BindingsItem:
    """
    Attributes:
        role (UpdateApiKeyResponse200BindingsItemRole | Unset):
        scope_type (UpdateApiKeyResponse200BindingsItemScopeType | Unset):
        scope_id (str | Unset):
    """

    role: UpdateApiKeyResponse200BindingsItemRole | Unset = UNSET
    scope_type: UpdateApiKeyResponse200BindingsItemScopeType | Unset = UNSET
    scope_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role: str | Unset = UNSET
        if not isinstance(self.role, Unset):
            role = self.role.value

        scope_type: str | Unset = UNSET
        if not isinstance(self.scope_type, Unset):
            scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if role is not UNSET:
            field_dict["role"] = role
        if scope_type is not UNSET:
            field_dict["scopeType"] = scope_type
        if scope_id is not UNSET:
            field_dict["scopeId"] = scope_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _role = d.pop("role", UNSET)
        role: UpdateApiKeyResponse200BindingsItemRole | Unset
        if isinstance(_role, Unset):
            role = UNSET
        else:
            role = UpdateApiKeyResponse200BindingsItemRole(_role)

        _scope_type = d.pop("scopeType", UNSET)
        scope_type: UpdateApiKeyResponse200BindingsItemScopeType | Unset
        if isinstance(_scope_type, Unset):
            scope_type = UNSET
        else:
            scope_type = UpdateApiKeyResponse200BindingsItemScopeType(_scope_type)

        scope_id = d.pop("scopeId", UNSET)

        update_api_key_response_200_bindings_item = cls(
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        update_api_key_response_200_bindings_item.additional_properties = d
        return update_api_key_response_200_bindings_item

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
