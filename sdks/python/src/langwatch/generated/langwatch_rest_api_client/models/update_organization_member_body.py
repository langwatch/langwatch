from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_organization_member_body_role import UpdateOrganizationMemberBodyRole
from ..types import UNSET, Unset

T = TypeVar("T", bound="UpdateOrganizationMemberBody")


@_attrs_define
class UpdateOrganizationMemberBody:
    """
    Attributes:
        role (UpdateOrganizationMemberBodyRole | Unset):
        disabled (bool | Unset):
    """

    role: UpdateOrganizationMemberBodyRole | Unset = UNSET
    disabled: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role: str | Unset = UNSET
        if not isinstance(self.role, Unset):
            role = self.role.value

        disabled = self.disabled

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if role is not UNSET:
            field_dict["role"] = role
        if disabled is not UNSET:
            field_dict["disabled"] = disabled

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _role = d.pop("role", UNSET)
        role: UpdateOrganizationMemberBodyRole | Unset
        if isinstance(_role, Unset):
            role = UNSET
        else:
            role = UpdateOrganizationMemberBodyRole(_role)

        disabled = d.pop("disabled", UNSET)

        update_organization_member_body = cls(
            role=role,
            disabled=disabled,
        )

        update_organization_member_body.additional_properties = d
        return update_organization_member_body

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
