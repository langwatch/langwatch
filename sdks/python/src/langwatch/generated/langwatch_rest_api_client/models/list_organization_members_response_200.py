from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.list_organization_members_response_200_members_item import (
        ListOrganizationMembersResponse200MembersItem,
    )


T = TypeVar("T", bound="ListOrganizationMembersResponse200")


@_attrs_define
class ListOrganizationMembersResponse200:
    """
    Attributes:
        members (list[ListOrganizationMembersResponse200MembersItem]):
        total_count (float):
    """

    members: list[ListOrganizationMembersResponse200MembersItem]
    total_count: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        members = []
        for members_item_data in self.members:
            members_item = members_item_data.to_dict()
            members.append(members_item)

        total_count = self.total_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "members": members,
                "totalCount": total_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_organization_members_response_200_members_item import (
            ListOrganizationMembersResponse200MembersItem,
        )

        d = dict(src_dict)
        members = []
        _members = d.pop("members")
        for members_item_data in _members:
            members_item = ListOrganizationMembersResponse200MembersItem.from_dict(members_item_data)

            members.append(members_item)

        total_count = d.pop("totalCount")

        list_organization_members_response_200 = cls(
            members=members,
            total_count=total_count,
        )

        list_organization_members_response_200.additional_properties = d
        return list_organization_members_response_200

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
