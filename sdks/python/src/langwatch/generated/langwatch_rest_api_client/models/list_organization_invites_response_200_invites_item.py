from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

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
        expiration (datetime.datetime | None):
        invite_code (str):
        invite_url (str):
        teams (list[ListOrganizationInvitesResponse200InvitesItemTeamsItem]):
        created_at (datetime.datetime):
    """

    id: str
    email: str
    role: ListOrganizationInvitesResponse200InvitesItemRole
    status: str
    expiration: datetime.datetime | None
    invite_code: str
    invite_url: str
    teams: list[ListOrganizationInvitesResponse200InvitesItemTeamsItem]
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        email = self.email

        role = self.role.value

        status = self.status

        expiration: None | str
        if isinstance(self.expiration, datetime.datetime):
            expiration = self.expiration.isoformat()
        else:
            expiration = self.expiration

        invite_code = self.invite_code

        invite_url = self.invite_url

        teams = []
        for teams_item_data in self.teams:
            teams_item = teams_item_data.to_dict()
            teams.append(teams_item)

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

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

        def _parse_expiration(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                expiration_type_0 = isoparse(data)

                return expiration_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        expiration = _parse_expiration(d.pop("expiration"))

        invite_code = d.pop("inviteCode")

        invite_url = d.pop("inviteUrl")

        teams = []
        _teams = d.pop("teams")
        for teams_item_data in _teams:
            teams_item = ListOrganizationInvitesResponse200InvitesItemTeamsItem.from_dict(teams_item_data)

            teams.append(teams_item)

        created_at = isoparse(d.pop("createdAt"))

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

        return list_organization_invites_response_200_invites_item
