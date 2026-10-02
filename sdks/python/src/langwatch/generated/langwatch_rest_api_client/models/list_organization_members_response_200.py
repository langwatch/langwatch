from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        members = []
        for members_item_data in self.members:
            members_item = members_item_data.to_dict()
            members.append(members_item)

        total_count = self.total_count

        field_dict: dict[str, Any] = {}

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

        return list_organization_members_response_200
