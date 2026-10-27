from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="CreateOrganizationInvitesResponse201InvitesItemTeamsItem")


@_attrs_define
class CreateOrganizationInvitesResponse201InvitesItemTeamsItem:
    """
    Attributes:
        team_id (str):
        role (str):
        custom_role_id (None | str):
    """

    team_id: str
    role: str
    custom_role_id: None | str

    def to_dict(self) -> dict[str, Any]:
        team_id = self.team_id

        role = self.role

        custom_role_id: None | str
        custom_role_id = self.custom_role_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "teamId": team_id,
                "role": role,
                "customRoleId": custom_role_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        team_id = d.pop("teamId")

        role = d.pop("role")

        def _parse_custom_role_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_role_id = _parse_custom_role_id(d.pop("customRoleId"))

        create_organization_invites_response_201_invites_item_teams_item = cls(
            team_id=team_id,
            role=role,
            custom_role_id=custom_role_id,
        )

        return create_organization_invites_response_201_invites_item_teams_item
