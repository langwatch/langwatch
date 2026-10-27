from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="CreateGrantResponse201Role")


@_attrs_define
class CreateGrantResponse201Role:
    """
    Attributes:
        id (str):
        name (None | str):
        built_in (bool):
    """

    id: str
    name: None | str
    built_in: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name: None | str
        name = self.name

        built_in = self.built_in

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "builtIn": built_in,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        built_in = d.pop("builtIn")

        create_grant_response_201_role = cls(
            id=id,
            name=name,
            built_in=built_in,
        )

        return create_grant_response_201_role
