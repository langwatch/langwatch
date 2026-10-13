from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        resource = self.resource

        organization_exclusive = self.organization_exclusive

        actions = self.actions

        permissions = self.permissions

        field_dict: dict[str, Any] = {}

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

        return list_role_permissions_response_200_resources_item
