from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_api_key_body_bindings_item_role import CreateApiKeyBodyBindingsItemRole
from ..models.create_api_key_body_bindings_item_scope_type import CreateApiKeyBodyBindingsItemScopeType

T = TypeVar("T", bound="CreateApiKeyBodyBindingsItem")


@_attrs_define
class CreateApiKeyBodyBindingsItem:
    """
    Attributes:
        role (CreateApiKeyBodyBindingsItemRole): CUSTOM grants exactly the listed permissions and requires
            permissionMode 'restricted'.
        scope_type (CreateApiKeyBodyBindingsItemScopeType):
        scope_id (str):
    """

    role: CreateApiKeyBodyBindingsItemRole
    scope_type: CreateApiKeyBodyBindingsItemScopeType
    scope_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "role": role,
                "scopeType": scope_type,
                "scopeId": scope_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = CreateApiKeyBodyBindingsItemRole(d.pop("role"))

        scope_type = CreateApiKeyBodyBindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        create_api_key_body_bindings_item = cls(
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        create_api_key_body_bindings_item.additional_properties = d
        return create_api_key_body_bindings_item

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
