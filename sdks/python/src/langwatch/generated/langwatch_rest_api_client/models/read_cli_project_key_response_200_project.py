from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliProjectKeyResponse200Project")


@_attrs_define
class ReadCliProjectKeyResponse200Project:
    """
    Attributes:
        id (str):
        slug (str):
        name (str):
    """

    id: str
    slug: str
    name: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        slug = self.slug

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        name = d.pop("name")

        read_cli_project_key_response_200_project = cls(
            id=id,
            slug=slug,
            name=name,
        )

        return read_cli_project_key_response_200_project
