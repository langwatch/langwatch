from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ListRolePermissionsResponse200ResourcesItem")


@_attrs_define
class ListRolePermissionsResponse200ResourcesItem:
    """
    Attributes:
        resource (str):
        organization_exclusive (bool):
        actions (list[str]):
        permissions (list[str]):
    """

    resource: str
    organization_exclusive: bool
    actions: list[str]
    permissions: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        resource = self.resource

        organization_exclusive = self.organization_exclusive

        actions = self.actions

        permissions = self.permissions

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "resource": resource,
                "organizationExclusive": organization_exclusive,
                "actions": actions,
                "permissions": permissions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        resource = d.pop("resource")

        organization_exclusive = d.pop("organizationExclusive")

        actions = cast(list[str], d.pop("actions"))

        permissions = cast(list[str], d.pop("permissions"))

        list_role_permissions_response_200_resources_item = cls(
            resource=resource,
            organization_exclusive=organization_exclusive,
            actions=actions,
            permissions=permissions,
        )

        list_role_permissions_response_200_resources_item.additional_properties = d
        return list_role_permissions_response_200_resources_item

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
