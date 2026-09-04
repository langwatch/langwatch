from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ListOrganizationInvitesResponse200InvitesItemTeamsItem")


@_attrs_define
class ListOrganizationInvitesResponse200InvitesItemTeamsItem:
    """
    Attributes:
        team_id (str):
        role (str):
        custom_role_id (None | str):
    """

    team_id: str
    role: str
    custom_role_id: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        team_id = self.team_id

        role = self.role

        custom_role_id: None | str
        custom_role_id = self.custom_role_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        list_organization_invites_response_200_invites_item_teams_item = cls(
            team_id=team_id,
            role=role,
            custom_role_id=custom_role_id,
        )

        list_organization_invites_response_200_invites_item_teams_item.additional_properties = d
        return list_organization_invites_response_200_invites_item_teams_item

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
