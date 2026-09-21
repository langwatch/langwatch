from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key_scopes_item_scope_type import (
    GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyScopesItemScopeType,
)

T = TypeVar("T", bound="GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyScopesItem")


@_attrs_define
class GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyScopesItem:
    """
    Attributes:
        scope_type (GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyScopesItemScopeType):
        scope_id (str):
    """

    scope_type: GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyScopesItemScopeType
    scope_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scope_type": scope_type,
                "scope_id": scope_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scope_type = GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyScopesItemScopeType(d.pop("scope_type"))

        scope_id = d.pop("scope_id")

        get_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key_scopes_item = cls(
            scope_type=scope_type,
            scope_id=scope_id,
        )

        get_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key_scopes_item.additional_properties = d
        return get_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key_scopes_item

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
