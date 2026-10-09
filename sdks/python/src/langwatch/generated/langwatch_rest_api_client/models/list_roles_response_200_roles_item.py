from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ListRolesResponse200RolesItem")


@_attrs_define
class ListRolesResponse200RolesItem:
    """
    Attributes:
        id (str):
        name (str):
        description (None | str):
        permissions (list[str]):
        created_at (str):
        updated_at (str):
    """

    id: str
    name: str
    description: None | str
    permissions: list[str]
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        description: None | str
        description = self.description

        permissions = self.permissions

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "description": description,
                "permissions": permissions,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        permissions = cast(list[str], d.pop("permissions"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        list_roles_response_200_roles_item = cls(
            id=id,
            name=name,
            description=description,
            permissions=permissions,
            created_at=created_at,
            updated_at=updated_at,
        )

        list_roles_response_200_roles_item.additional_properties = d
        return list_roles_response_200_roles_item

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
