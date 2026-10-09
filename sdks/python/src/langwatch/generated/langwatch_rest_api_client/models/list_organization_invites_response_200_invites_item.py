from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.list_organization_invites_response_200_invites_item_role import (
    ListOrganizationInvitesResponse200InvitesItemRole,
)

if TYPE_CHECKING:
    from ..models.list_organization_invites_response_200_invites_item_teams_item import (
        ListOrganizationInvitesResponse200InvitesItemTeamsItem,
    )


T = TypeVar("T", bound="ListOrganizationInvitesResponse200InvitesItem")


@_attrs_define
class ListOrganizationInvitesResponse200InvitesItem:
    """
    Attributes:
        id (str):
        email (str):
        role (ListOrganizationInvitesResponse200InvitesItemRole):
        status (str):
        expiration (None | str):
        invite_code (str):
        invite_url (str):
        teams (list[ListOrganizationInvitesResponse200InvitesItemTeamsItem]):
        created_at (str):
    """

    id: str
    email: str
    role: ListOrganizationInvitesResponse200InvitesItemRole
    status: str
    expiration: None | str
    invite_code: str
    invite_url: str
    teams: list[ListOrganizationInvitesResponse200InvitesItemTeamsItem]
    created_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        email = self.email

        role = self.role.value

        status = self.status

        expiration: None | str
        expiration = self.expiration

        invite_code = self.invite_code

        invite_url = self.invite_url

        teams = []
        for teams_item_data in self.teams:
            teams_item = teams_item_data.to_dict()
            teams.append(teams_item)

        created_at = self.created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "email": email,
                "role": role,
                "status": status,
                "expiration": expiration,
                "inviteCode": invite_code,
                "inviteUrl": invite_url,
                "teams": teams,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_organization_invites_response_200_invites_item_teams_item import (
            ListOrganizationInvitesResponse200InvitesItemTeamsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        email = d.pop("email")

        role = ListOrganizationInvitesResponse200InvitesItemRole(d.pop("role"))

        status = d.pop("status")

        def _parse_expiration(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        expiration = _parse_expiration(d.pop("expiration"))

        invite_code = d.pop("inviteCode")

        invite_url = d.pop("inviteUrl")

        teams = []
        _teams = d.pop("teams")
        for teams_item_data in _teams:
            teams_item = ListOrganizationInvitesResponse200InvitesItemTeamsItem.from_dict(teams_item_data)

            teams.append(teams_item)

        created_at = d.pop("createdAt")

        list_organization_invites_response_200_invites_item = cls(
            id=id,
            email=email,
            role=role,
            status=status,
            expiration=expiration,
            invite_code=invite_code,
            invite_url=invite_url,
            teams=teams,
            created_at=created_at,
        )

        list_organization_invites_response_200_invites_item.additional_properties = d
        return list_organization_invites_response_200_invites_item

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
