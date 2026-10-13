from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_teams_by_id_members_response_200_data_item_role import (
    GetApiTeamsByIdMembersResponse200DataItemRole,
)

T = TypeVar("T", bound="GetApiTeamsByIdMembersResponse200DataItem")


@_attrs_define
class GetApiTeamsByIdMembersResponse200DataItem:
    """
    Attributes:
        user_id (str):
        name (None | str):
        email (None | str):
        role (GetApiTeamsByIdMembersResponse200DataItemRole):
    """

    user_id: str
    name: None | str
    email: None | str
    role: GetApiTeamsByIdMembersResponse200DataItemRole

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        name: None | str
        name = self.name

        email: None | str
        email = self.email

        role = self.role.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "userId": user_id,
                "name": name,
                "email": email,
                "role": role,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_id = d.pop("userId")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        def _parse_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        email = _parse_email(d.pop("email"))

        role = GetApiTeamsByIdMembersResponse200DataItemRole(d.pop("role"))

        get_api_teams_by_id_members_response_200_data_item = cls(
            user_id=user_id,
            name=name,
            email=email,
            role=role,
        )

        return get_api_teams_by_id_members_response_200_data_item
