from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_role_permissions_response_200_resources_item import ListRolePermissionsResponse200ResourcesItem


T = TypeVar("T", bound="ListRolePermissionsResponse200")


@_attrs_define
class ListRolePermissionsResponse200:
    """
    Attributes:
        resources (list[ListRolePermissionsResponse200ResourcesItem]):
        actions (list[str]):
    """

    resources: list[ListRolePermissionsResponse200ResourcesItem]
    actions: list[str]

    def to_dict(self) -> dict[str, Any]:
        resources = []
        for resources_item_data in self.resources:
            resources_item = resources_item_data.to_dict()
            resources.append(resources_item)

        actions = self.actions

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "resources": resources,
                "actions": actions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_role_permissions_response_200_resources_item import (
            ListRolePermissionsResponse200ResourcesItem,
        )

        d = dict(src_dict)
        resources = []
        _resources = d.pop("resources")
        for resources_item_data in _resources:
            resources_item = ListRolePermissionsResponse200ResourcesItem.from_dict(resources_item_data)

            resources.append(resources_item)

        actions = cast(list[str], d.pop("actions"))

        list_role_permissions_response_200 = cls(
            resources=resources,
            actions=actions,
        )

        return list_role_permissions_response_200
