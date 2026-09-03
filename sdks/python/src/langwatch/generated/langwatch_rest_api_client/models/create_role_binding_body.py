from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_role_binding_body_role import CreateRoleBindingBodyRole
from ..models.create_role_binding_body_scope_type import CreateRoleBindingBodyScopeType
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateRoleBindingBody")


@_attrs_define
class CreateRoleBindingBody:
    """
    Attributes:
        role (CreateRoleBindingBodyRole):
        scope_type (CreateRoleBindingBodyScopeType):
        scope_id (str):
        user_id (str | Unset):
        group_id (str | Unset):
        api_key_id (str | Unset):
        custom_role_id (str | Unset):
    """

    role: CreateRoleBindingBodyRole
    scope_type: CreateRoleBindingBodyScopeType
    scope_id: str
    user_id: str | Unset = UNSET
    group_id: str | Unset = UNSET
    api_key_id: str | Unset = UNSET
    custom_role_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        user_id = self.user_id

        group_id = self.group_id

        api_key_id = self.api_key_id

        custom_role_id = self.custom_role_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "role": role,
                "scopeType": scope_type,
                "scopeId": scope_id,
            }
        )
        if user_id is not UNSET:
            field_dict["userId"] = user_id
        if group_id is not UNSET:
            field_dict["groupId"] = group_id
        if api_key_id is not UNSET:
            field_dict["apiKeyId"] = api_key_id
        if custom_role_id is not UNSET:
            field_dict["customRoleId"] = custom_role_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = CreateRoleBindingBodyRole(d.pop("role"))

        scope_type = CreateRoleBindingBodyScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        user_id = d.pop("userId", UNSET)

        group_id = d.pop("groupId", UNSET)

        api_key_id = d.pop("apiKeyId", UNSET)

        custom_role_id = d.pop("customRoleId", UNSET)

        create_role_binding_body = cls(
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
            user_id=user_id,
            group_id=group_id,
            api_key_id=api_key_id,
            custom_role_id=custom_role_id,
        )

        create_role_binding_body.additional_properties = d
        return create_role_binding_body

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
