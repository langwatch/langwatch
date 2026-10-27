from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.create_grant_body_scope_type import CreateGrantBodyScopeType

T = TypeVar("T", bound="CreateGrantBodyScope")


@_attrs_define
class CreateGrantBodyScope:
    """
    Attributes:
        type_ (CreateGrantBodyScopeType):
        id (str):
    """

    type_: CreateGrantBodyScopeType
    id: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        id = self.id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "id": id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = CreateGrantBodyScopeType(d.pop("type"))

        id = d.pop("id")

        create_grant_body_scope = cls(
            type_=type_,
            id=id,
        )

        return create_grant_body_scope
