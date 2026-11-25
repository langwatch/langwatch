from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="MintCliIngestionKeyResponse201Project")


@_attrs_define
class MintCliIngestionKeyResponse201Project:
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

        mint_cli_ingestion_key_response_201_project = cls(
            id=id,
            slug=slug,
            name=name,
        )

        return mint_cli_ingestion_key_response_201_project
