from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_groups_by_id_bindings_response_201_role import PostApiGroupsByIdBindingsResponse201Role
from ..models.post_api_groups_by_id_bindings_response_201_scope_type import (
    PostApiGroupsByIdBindingsResponse201ScopeType,
)

T = TypeVar("T", bound="PostApiGroupsByIdBindingsResponse201")


@_attrs_define
class PostApiGroupsByIdBindingsResponse201:
    """
    Attributes:
        id (str):
        role (PostApiGroupsByIdBindingsResponse201Role):
        scope_type (PostApiGroupsByIdBindingsResponse201ScopeType):
        scope_id (str):
    """

    id: str
    role: PostApiGroupsByIdBindingsResponse201Role
    scope_type: PostApiGroupsByIdBindingsResponse201ScopeType
    scope_id: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        role = self.role.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "role": role,
                "scopeType": scope_type,
                "scopeId": scope_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        role = PostApiGroupsByIdBindingsResponse201Role(d.pop("role"))

        scope_type = PostApiGroupsByIdBindingsResponse201ScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        post_api_groups_by_id_bindings_response_201 = cls(
            id=id,
            role=role,
            scope_type=scope_type,
            scope_id=scope_id,
        )

        return post_api_groups_by_id_bindings_response_201
