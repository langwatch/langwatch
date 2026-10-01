from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_organization_member_response_200_role import GetOrganizationMemberResponse200Role

if TYPE_CHECKING:
    from ..models.get_organization_member_response_200_teams_item import GetOrganizationMemberResponse200TeamsItem
    from ..models.get_organization_member_response_200_user import GetOrganizationMemberResponse200User


T = TypeVar("T", bound="GetOrganizationMemberResponse200")


@_attrs_define
class GetOrganizationMemberResponse200:
    """
    Attributes:
        user_id (str):
        role (GetOrganizationMemberResponse200Role):
        disabled (bool):
        disabled_at (datetime.datetime | None):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        user (GetOrganizationMemberResponse200User):
        teams (list[GetOrganizationMemberResponse200TeamsItem]):
    """

    user_id: str
    role: GetOrganizationMemberResponse200Role
    disabled: bool
    disabled_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    user: GetOrganizationMemberResponse200User
    teams: list[GetOrganizationMemberResponse200TeamsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        role = self.role.value

        disabled = self.disabled

        disabled_at: None | str
        if isinstance(self.disabled_at, datetime.datetime):
            disabled_at = self.disabled_at.isoformat()
        else:
            disabled_at = self.disabled_at

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        user = self.user.to_dict()

        teams = []
        for teams_item_data in self.teams:
            teams_item = teams_item_data.to_dict()
            teams.append(teams_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "userId": user_id,
                "role": role,
                "disabled": disabled,
                "disabledAt": disabled_at,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "user": user,
                "teams": teams,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_organization_member_response_200_teams_item import GetOrganizationMemberResponse200TeamsItem
        from ..models.get_organization_member_response_200_user import GetOrganizationMemberResponse200User

        d = dict(src_dict)
        user_id = d.pop("userId")

        role = GetOrganizationMemberResponse200Role(d.pop("role"))

        disabled = d.pop("disabled")

        def _parse_disabled_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                disabled_at_type_0 = isoparse(data)

                return disabled_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        disabled_at = _parse_disabled_at(d.pop("disabledAt"))

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        user = GetOrganizationMemberResponse200User.from_dict(d.pop("user"))

        teams = []
        _teams = d.pop("teams")
        for teams_item_data in _teams:
            teams_item = GetOrganizationMemberResponse200TeamsItem.from_dict(teams_item_data)

            teams.append(teams_item)

        get_organization_member_response_200 = cls(
            user_id=user_id,
            role=role,
            disabled=disabled,
            disabled_at=disabled_at,
            created_at=created_at,
            updated_at=updated_at,
            user=user,
            teams=teams,
        )

        get_organization_member_response_200.additional_properties = d
        return get_organization_member_response_200

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
