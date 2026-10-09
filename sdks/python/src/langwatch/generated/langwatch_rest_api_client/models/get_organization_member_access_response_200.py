from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_organization_member_access_response_200_direct_bindings_item import (
        GetOrganizationMemberAccessResponse200DirectBindingsItem,
    )
    from ..models.get_organization_member_access_response_200_groups_item import (
        GetOrganizationMemberAccessResponse200GroupsItem,
    )
    from ..models.get_organization_member_access_response_200_user import GetOrganizationMemberAccessResponse200User


T = TypeVar("T", bound="GetOrganizationMemberAccessResponse200")


@_attrs_define
class GetOrganizationMemberAccessResponse200:
    """
    Attributes:
        user (GetOrganizationMemberAccessResponse200User):
        groups (list[GetOrganizationMemberAccessResponse200GroupsItem]):
        direct_bindings (list[GetOrganizationMemberAccessResponse200DirectBindingsItem]):
    """

    user: GetOrganizationMemberAccessResponse200User
    groups: list[GetOrganizationMemberAccessResponse200GroupsItem]
    direct_bindings: list[GetOrganizationMemberAccessResponse200DirectBindingsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        user = self.user.to_dict()

        groups = []
        for groups_item_data in self.groups:
            groups_item = groups_item_data.to_dict()
            groups.append(groups_item)

        direct_bindings = []
        for direct_bindings_item_data in self.direct_bindings:
            direct_bindings_item = direct_bindings_item_data.to_dict()
            direct_bindings.append(direct_bindings_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "user": user,
                "groups": groups,
                "directBindings": direct_bindings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_organization_member_access_response_200_direct_bindings_item import (
            GetOrganizationMemberAccessResponse200DirectBindingsItem,
        )
        from ..models.get_organization_member_access_response_200_groups_item import (
            GetOrganizationMemberAccessResponse200GroupsItem,
        )
        from ..models.get_organization_member_access_response_200_user import GetOrganizationMemberAccessResponse200User

        d = dict(src_dict)
        user = GetOrganizationMemberAccessResponse200User.from_dict(d.pop("user"))

        groups = []
        _groups = d.pop("groups")
        for groups_item_data in _groups:
            groups_item = GetOrganizationMemberAccessResponse200GroupsItem.from_dict(groups_item_data)

            groups.append(groups_item)

        direct_bindings = []
        _direct_bindings = d.pop("directBindings")
        for direct_bindings_item_data in _direct_bindings:
            direct_bindings_item = GetOrganizationMemberAccessResponse200DirectBindingsItem.from_dict(
                direct_bindings_item_data
            )

            direct_bindings.append(direct_bindings_item)

        get_organization_member_access_response_200 = cls(
            user=user,
            groups=groups,
            direct_bindings=direct_bindings,
        )

        get_organization_member_access_response_200.additional_properties = d
        return get_organization_member_access_response_200

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
