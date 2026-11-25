from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.create_role_binding_response_201_principal_type import CreateRoleBindingResponse201PrincipalType

T = TypeVar("T", bound="CreateRoleBindingResponse201Principal")


@_attrs_define
class CreateRoleBindingResponse201Principal:
    """
    Attributes:
        type_ (CreateRoleBindingResponse201PrincipalType):
        id (str):
        name (None | str):
    """

    type_: CreateRoleBindingResponse201PrincipalType
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
        type_ = CreateRoleBindingResponse201PrincipalType(d.pop("type"))

        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        create_role_binding_response_201_principal = cls(
            type_=type_,
            id=id,
            name=name,
        )

        return create_role_binding_response_201_principal
