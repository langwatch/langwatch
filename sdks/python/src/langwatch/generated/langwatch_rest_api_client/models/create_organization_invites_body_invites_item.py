from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_organization_invites_body_invites_item_role import CreateOrganizationInvitesBodyInvitesItemRole

if TYPE_CHECKING:
    from ..models.create_organization_invites_body_invites_item_teams_item import (
        CreateOrganizationInvitesBodyInvitesItemTeamsItem,
    )


T = TypeVar("T", bound="CreateOrganizationInvitesBodyInvitesItem")


@_attrs_define
class CreateOrganizationInvitesBodyInvitesItem:
    """
    Attributes:
        email (str):
        role (CreateOrganizationInvitesBodyInvitesItemRole):
        teams (list[CreateOrganizationInvitesBodyInvitesItemTeamsItem]):
    """

    email: str
    role: CreateOrganizationInvitesBodyInvitesItemRole
    teams: list[CreateOrganizationInvitesBodyInvitesItemTeamsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        email = self.email

        role = self.role.value

        teams = []
        for teams_item_data in self.teams:
            teams_item = teams_item_data.to_dict()
            teams.append(teams_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "email": email,
                "role": role,
                "teams": teams,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_organization_invites_body_invites_item_teams_item import (
            CreateOrganizationInvitesBodyInvitesItemTeamsItem,
        )

        d = dict(src_dict)
        email = d.pop("email")

        role = CreateOrganizationInvitesBodyInvitesItemRole(d.pop("role"))

        teams = []
        _teams = d.pop("teams")
        for teams_item_data in _teams:
            teams_item = CreateOrganizationInvitesBodyInvitesItemTeamsItem.from_dict(teams_item_data)

            teams.append(teams_item)

        create_organization_invites_body_invites_item = cls(
            email=email,
            role=role,
            teams=teams,
        )

        create_organization_invites_body_invites_item.additional_properties = d
        return create_organization_invites_body_invites_item

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
