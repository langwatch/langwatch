from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.list_role_bindings_response_200_bindings_item_principal_type import (
    ListRoleBindingsResponse200BindingsItemPrincipalType,
)

T = TypeVar("T", bound="ListRoleBindingsResponse200BindingsItemPrincipal")


@_attrs_define
class ListRoleBindingsResponse200BindingsItemPrincipal:
    """
    Attributes:
        type_ (ListRoleBindingsResponse200BindingsItemPrincipalType):
        id (str):
        name (None | str):
    """

    type_: ListRoleBindingsResponse200BindingsItemPrincipalType
    id: str
    name: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        id = self.id

        name: None | str
        name = self.name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "id": id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ListRoleBindingsResponse200BindingsItemPrincipalType(d.pop("type"))

        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        list_role_bindings_response_200_bindings_item_principal = cls(
            type_=type_,
            id=id,
            name=name,
        )

        list_role_bindings_response_200_bindings_item_principal.additional_properties = d
        return list_role_bindings_response_200_bindings_item_principal

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
