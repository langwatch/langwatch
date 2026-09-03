from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_organization_member_response_200_role import UpdateOrganizationMemberResponse200Role
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.update_organization_member_response_200_teams_left_without_admin_item import (
        UpdateOrganizationMemberResponse200TeamsLeftWithoutAdminItem,
    )
    from ..models.update_organization_member_response_200_user import UpdateOrganizationMemberResponse200User


T = TypeVar("T", bound="UpdateOrganizationMemberResponse200")


@_attrs_define
class UpdateOrganizationMemberResponse200:
    """
    Attributes:
        user_id (str):
        role (UpdateOrganizationMemberResponse200Role):
        disabled (bool):
        disabled_at (None | str):
        created_at (str):
        updated_at (str):
        user (UpdateOrganizationMemberResponse200User):
        teams_left_without_admin (list[UpdateOrganizationMemberResponse200TeamsLeftWithoutAdminItem] | Unset):
    """

    user_id: str
    role: UpdateOrganizationMemberResponse200Role
    disabled: bool
    disabled_at: None | str
    created_at: str
    updated_at: str
    user: UpdateOrganizationMemberResponse200User
    teams_left_without_admin: list[UpdateOrganizationMemberResponse200TeamsLeftWithoutAdminItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        role = self.role.value

        disabled = self.disabled

        disabled_at: None | str
        disabled_at = self.disabled_at

        created_at = self.created_at

        updated_at = self.updated_at

        user = self.user.to_dict()

        teams_left_without_admin: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.teams_left_without_admin, Unset):
            teams_left_without_admin = []
            for teams_left_without_admin_item_data in self.teams_left_without_admin:
                teams_left_without_admin_item = teams_left_without_admin_item_data.to_dict()
                teams_left_without_admin.append(teams_left_without_admin_item)

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
            }
        )
        if teams_left_without_admin is not UNSET:
            field_dict["teamsLeftWithoutAdmin"] = teams_left_without_admin

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_organization_member_response_200_teams_left_without_admin_item import (
            UpdateOrganizationMemberResponse200TeamsLeftWithoutAdminItem,
        )
        from ..models.update_organization_member_response_200_user import UpdateOrganizationMemberResponse200User

        d = dict(src_dict)
        user_id = d.pop("userId")

        role = UpdateOrganizationMemberResponse200Role(d.pop("role"))

        disabled = d.pop("disabled")

        def _parse_disabled_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        disabled_at = _parse_disabled_at(d.pop("disabledAt"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        user = UpdateOrganizationMemberResponse200User.from_dict(d.pop("user"))

        _teams_left_without_admin = d.pop("teamsLeftWithoutAdmin", UNSET)
        teams_left_without_admin: list[UpdateOrganizationMemberResponse200TeamsLeftWithoutAdminItem] | Unset = UNSET
        if _teams_left_without_admin is not UNSET:
            teams_left_without_admin = []
            for teams_left_without_admin_item_data in _teams_left_without_admin:
                teams_left_without_admin_item = UpdateOrganizationMemberResponse200TeamsLeftWithoutAdminItem.from_dict(
                    teams_left_without_admin_item_data
                )

                teams_left_without_admin.append(teams_left_without_admin_item)

        update_organization_member_response_200 = cls(
            user_id=user_id,
            role=role,
            disabled=disabled,
            disabled_at=disabled_at,
            created_at=created_at,
            updated_at=updated_at,
            user=user,
            teams_left_without_admin=teams_left_without_admin,
        )

        update_organization_member_response_200.additional_properties = d
        return update_organization_member_response_200

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
