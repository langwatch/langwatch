from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_organization_invites_response_200_invites_item import (
        ListOrganizationInvitesResponse200InvitesItem,
    )


T = TypeVar("T", bound="ListOrganizationInvitesResponse200")


@_attrs_define
class ListOrganizationInvitesResponse200:
    """
    Attributes:
        invites (list[ListOrganizationInvitesResponse200InvitesItem]):
    """

    invites: list[ListOrganizationInvitesResponse200InvitesItem]

    def to_dict(self) -> dict[str, Any]:
        invites = []
        for invites_item_data in self.invites:
            invites_item = invites_item_data.to_dict()
            invites.append(invites_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "invites": invites,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_organization_invites_response_200_invites_item import (
            ListOrganizationInvitesResponse200InvitesItem,
        )

        d = dict(src_dict)
        invites = []
        _invites = d.pop("invites")
        for invites_item_data in _invites:
            invites_item = ListOrganizationInvitesResponse200InvitesItem.from_dict(invites_item_data)

            invites.append(invites_item)

        list_organization_invites_response_200 = cls(
            invites=invites,
        )

        return list_organization_invites_response_200
