from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.update_api_key_response_200_bindings_item_role import UpdateApiKeyResponse200BindingsItemRole
from ..models.update_api_key_response_200_bindings_item_scope_type import UpdateApiKeyResponse200BindingsItemScopeType

T = TypeVar("T", bound="UpdateApiKeyResponse200BindingsItem")


@_attrs_define
class UpdateApiKeyResponse200BindingsItem:
    """
    Attributes:
        role (UpdateApiKeyResponse200BindingsItemRole):
        scope_type (UpdateApiKeyResponse200BindingsItemScopeType):
        scope_id (str):
    """

    role: UpdateApiKeyResponse200BindingsItemRole
    scope_type: UpdateApiKeyResponse200BindingsItemScopeType
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
        role = UpdateApiKeyResponse200BindingsItemRole(d.pop("role"))

        scope_type = UpdateApiKeyResponse200BindingsItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        update_api_key_response_200_bindings_item = cls(
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        return update_api_key_response_200_bindings_item
