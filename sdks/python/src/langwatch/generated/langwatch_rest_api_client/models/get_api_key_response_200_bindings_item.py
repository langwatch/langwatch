from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_key_response_200_bindings_item_role import GetApiKeyResponse200BindingsItemRole
from ..models.get_api_key_response_200_bindings_item_scope_type import GetApiKeyResponse200BindingsItemScopeType

T = TypeVar("T", bound="GetApiKeyResponse200BindingsItem")


@_attrs_define
class GetApiKeyResponse200BindingsItem:
    """
    Attributes:
        role (GetApiKeyResponse200BindingsItemRole):
        scope_type (GetApiKeyResponse200BindingsItemScopeType):
        scope_id (str):
    """

    role: GetApiKeyResponse200BindingsItemRole
    scope_type: GetApiKeyResponse200BindingsItemScopeType
    scope_id: str

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}

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
        role = GetApiKeyResponse200BindingsItemRole(d.pop("role"))

        scope_type = GetApiKeyResponse200BindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        get_api_key_response_200_bindings_item = cls(
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        return get_api_key_response_200_bindings_item
