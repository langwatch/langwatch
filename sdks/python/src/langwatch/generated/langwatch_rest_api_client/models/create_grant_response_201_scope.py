from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.create_grant_response_201_scope_type import CreateGrantResponse201ScopeType

T = TypeVar("T", bound="CreateGrantResponse201Scope")


@_attrs_define
class CreateGrantResponse201Scope:
    """
    Attributes:
        type_ (CreateGrantResponse201ScopeType):
        id (str):
        name (None | str):
    """

    type_: CreateGrantResponse201ScopeType
    id: str
    name: None | str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        id = self.id

        name: None | str
        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "id": id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = CreateGrantResponse201ScopeType(d.pop("type"))

        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        create_grant_response_201_scope = cls(
            type_=type_,
            id=id,
            name=name,
        )

        return create_grant_response_201_scope
