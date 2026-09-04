from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        invites = []
        for invites_item_data in self.invites:
            invites_item = invites_item_data.to_dict()
            invites.append(invites_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        create_organization_invites_response_201.additional_properties = d
        return create_organization_invites_response_201

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
