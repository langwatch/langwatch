from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.create_organization_invites_response_201_invites_item import (
        CreateOrganizationInvitesResponse201InvitesItem,
    )


T = TypeVar("T", bound="CreateOrganizationInvitesResponse201")


@_attrs_define
class CreateOrganizationInvitesResponse201:
    """
    Attributes:
        invites (list[CreateOrganizationInvitesResponse201InvitesItem]):
    """

    invites: list[CreateOrganizationInvitesResponse201InvitesItem]

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
        from ..models.create_organization_invites_response_201_invites_item import (
            CreateOrganizationInvitesResponse201InvitesItem,
        )

        d = dict(src_dict)
        invites = []
        _invites = d.pop("invites")
        for invites_item_data in _invites:
            invites_item = CreateOrganizationInvitesResponse201InvitesItem.from_dict(invites_item_data)

            invites.append(invites_item)

        create_organization_invites_response_201 = cls(
            invites=invites,
        )

        return create_organization_invites_response_201
