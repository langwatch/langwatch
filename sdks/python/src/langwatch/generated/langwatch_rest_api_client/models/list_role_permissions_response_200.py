from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        resources = []
        for resources_item_data in self.resources:
            resources_item = resources_item_data.to_dict()
            resources.append(resources_item)

        actions = self.actions

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        list_role_permissions_response_200.additional_properties = d
        return list_role_permissions_response_200

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
