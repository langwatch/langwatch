from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.update_role_binding_body_role import UpdateRoleBindingBodyRole
from ..types import UNSET, Unset

T = TypeVar("T", bound="UpdateRoleBindingBody")


@_attrs_define
class UpdateRoleBindingBody:
    """
    Attributes:
        role (UpdateRoleBindingBodyRole):
        custom_role_id (str | Unset):
    """

    role: UpdateRoleBindingBodyRole
    custom_role_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        custom_role_id = self.custom_role_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "role": role,
            }
        )
        if custom_role_id is not UNSET:
            field_dict["customRoleId"] = custom_role_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = UpdateRoleBindingBodyRole(d.pop("role"))

        custom_role_id = d.pop("customRoleId", UNSET)

        update_role_binding_body = cls(
            role=role,
            custom_role_id=custom_role_id,
        )

        update_role_binding_body.additional_properties = d
        return update_role_binding_body

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
