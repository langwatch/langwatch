from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_groups_by_id_bindings_body_role import PostApiGroupsByIdBindingsBodyRole
from ..models.post_api_groups_by_id_bindings_body_scope_type import PostApiGroupsByIdBindingsBodyScopeType
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGroupsByIdBindingsBody")


@_attrs_define
class PostApiGroupsByIdBindingsBody:
    """
    Attributes:
        role (PostApiGroupsByIdBindingsBodyRole):
        scope_type (PostApiGroupsByIdBindingsBodyScopeType):
        scope_id (str):
        custom_role_id (str | Unset):
    """

    role: PostApiGroupsByIdBindingsBodyRole
    scope_type: PostApiGroupsByIdBindingsBodyScopeType
    scope_id: str
    custom_role_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        custom_role_id = self.custom_role_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "role": role,
                "scopeType": scope_type,
                "scopeId": scope_id,
            }
        )
        if custom_role_id is not UNSET:
            field_dict["customRoleId"] = custom_role_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = PostApiGroupsByIdBindingsBodyRole(d.pop("role"))

        scope_type = PostApiGroupsByIdBindingsBodyScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        custom_role_id = d.pop("customRoleId", UNSET)

        post_api_groups_by_id_bindings_body = cls(
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
            custom_role_id=custom_role_id,
        )

        return post_api_groups_by_id_bindings_body
