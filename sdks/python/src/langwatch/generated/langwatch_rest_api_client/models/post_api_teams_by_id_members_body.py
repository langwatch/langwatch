from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_teams_by_id_members_body_role import PostApiTeamsByIdMembersBodyRole
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiTeamsByIdMembersBody")


@_attrs_define
class PostApiTeamsByIdMembersBody:
    """
    Attributes:
        user_id (str):
        role (PostApiTeamsByIdMembersBodyRole | Unset):  Default: PostApiTeamsByIdMembersBodyRole.MEMBER.
    """

    user_id: str
    role: PostApiTeamsByIdMembersBodyRole | Unset = PostApiTeamsByIdMembersBodyRole.MEMBER
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        role: str | Unset = UNSET
        if not isinstance(self.role, Unset):
            role = self.role.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "userId": user_id,
            }
        )
        if role is not UNSET:
            field_dict["role"] = role

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_id = d.pop("userId")

        _role = d.pop("role", UNSET)
        role: PostApiTeamsByIdMembersBodyRole | Unset
        if isinstance(_role, Unset):
            role = UNSET
        else:
            role = PostApiTeamsByIdMembersBodyRole(_role)

        post_api_teams_by_id_members_body = cls(
            user_id=user_id,
            role=role,
        )

        post_api_teams_by_id_members_body.additional_properties = d
        return post_api_teams_by_id_members_body

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
