from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_organization_member_response_200_teams_item_role import GetOrganizationMemberResponse200TeamsItemRole

T = TypeVar("T", bound="GetOrganizationMemberResponse200TeamsItem")


@_attrs_define
class GetOrganizationMemberResponse200TeamsItem:
    """
    Attributes:
        team_id (str):
        team_name (str):
        role (GetOrganizationMemberResponse200TeamsItemRole):
        custom_role_id (None | str):
        custom_role_name (None | str):
    """

    team_id: str
    team_name: str
    role: GetOrganizationMemberResponse200TeamsItemRole
    custom_role_id: None | str
    custom_role_name: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        team_id = self.team_id

        team_name = self.team_name

        role = self.role.value

        custom_role_id: None | str
        custom_role_id = self.custom_role_id

        custom_role_name: None | str
        custom_role_name = self.custom_role_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "teamId": team_id,
                "teamName": team_name,
                "role": role,
                "customRoleId": custom_role_id,
                "customRoleName": custom_role_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        team_id = d.pop("teamId")

        team_name = d.pop("teamName")

        role = GetOrganizationMemberResponse200TeamsItemRole(d.pop("role"))

        def _parse_custom_role_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_role_id = _parse_custom_role_id(d.pop("customRoleId"))

        def _parse_custom_role_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_role_name = _parse_custom_role_name(d.pop("customRoleName"))

        get_organization_member_response_200_teams_item = cls(
            team_id=team_id,
            team_name=team_name,
            role=role,
            custom_role_id=custom_role_id,
            custom_role_name=custom_role_name,
        )

        get_organization_member_response_200_teams_item.additional_properties = d
        return get_organization_member_response_200_teams_item

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
