from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_organization_invites_body_invites_item_teams_item_role import (
    CreateOrganizationInvitesBodyInvitesItemTeamsItemRole,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateOrganizationInvitesBodyInvitesItemTeamsItem")


@_attrs_define
class CreateOrganizationInvitesBodyInvitesItemTeamsItem:
    """
    Attributes:
        team_id (str):
        role (CreateOrganizationInvitesBodyInvitesItemTeamsItemRole):
        custom_role_id (str | Unset):
    """

    team_id: str
    role: CreateOrganizationInvitesBodyInvitesItemTeamsItemRole
    custom_role_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        team_id = self.team_id

        role = self.role.value

        custom_role_id = self.custom_role_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "teamId": team_id,
                "role": role,
            }
        )
        if custom_role_id is not UNSET:
            field_dict["customRoleId"] = custom_role_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        team_id = d.pop("teamId")

        role = CreateOrganizationInvitesBodyInvitesItemTeamsItemRole(d.pop("role"))

        custom_role_id = d.pop("customRoleId", UNSET)

        create_organization_invites_body_invites_item_teams_item = cls(
            team_id=team_id,
            role=role,
            custom_role_id=custom_role_id,
        )

        create_organization_invites_body_invites_item_teams_item.additional_properties = d
        return create_organization_invites_body_invites_item_teams_item

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
