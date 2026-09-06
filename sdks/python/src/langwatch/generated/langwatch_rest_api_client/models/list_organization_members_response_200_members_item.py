from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.list_organization_members_response_200_members_item_role import (
    ListOrganizationMembersResponse200MembersItemRole,
)

if TYPE_CHECKING:
    from ..models.list_organization_members_response_200_members_item_user import (
        ListOrganizationMembersResponse200MembersItemUser,
    )


T = TypeVar("T", bound="ListOrganizationMembersResponse200MembersItem")


@_attrs_define
class ListOrganizationMembersResponse200MembersItem:
    """
    Attributes:
        user_id (str):
        role (ListOrganizationMembersResponse200MembersItemRole):
        disabled (bool):
        disabled_at (None | str):
        created_at (str):
        updated_at (str):
        user (ListOrganizationMembersResponse200MembersItemUser):
    """

    user_id: str
    role: ListOrganizationMembersResponse200MembersItemRole
    disabled: bool
    disabled_at: None | str
    created_at: str
    updated_at: str
    user: ListOrganizationMembersResponse200MembersItemUser
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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_organization_members_response_200_members_item_user import (
            ListOrganizationMembersResponse200MembersItemUser,
        )

        d = dict(src_dict)
        user_id = d.pop("userId")

        role = ListOrganizationMembersResponse200MembersItemRole(d.pop("role"))

        disabled = d.pop("disabled")

        def _parse_disabled_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        disabled_at = _parse_disabled_at(d.pop("disabledAt"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        user = ListOrganizationMembersResponse200MembersItemUser.from_dict(d.pop("user"))

        list_organization_members_response_200_members_item = cls(
            user_id=user_id,
            role=role,
            disabled=disabled,
            disabled_at=disabled_at,
            created_at=created_at,
            updated_at=updated_at,
            user=user,
        )

        list_organization_members_response_200_members_item.additional_properties = d
        return list_organization_members_response_200_members_item

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
