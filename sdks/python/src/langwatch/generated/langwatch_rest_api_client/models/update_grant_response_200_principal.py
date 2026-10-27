from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.update_grant_response_200_principal_type import UpdateGrantResponse200PrincipalType

T = TypeVar("T", bound="UpdateGrantResponse200Principal")


@_attrs_define
class UpdateGrantResponse200Principal:
    """
    Attributes:
        type_ (UpdateGrantResponse200PrincipalType):
        id (str):
        name (None | str):
    """

    type_: UpdateGrantResponse200PrincipalType
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
        type_ = UpdateGrantResponse200PrincipalType(d.pop("type"))

        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        update_grant_response_200_principal = cls(
            type_=type_,
            id=id,
            name=name,
        )

        return update_grant_response_200_principal
