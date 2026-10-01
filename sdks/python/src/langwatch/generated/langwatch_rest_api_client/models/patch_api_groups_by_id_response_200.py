from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PatchApiGroupsByIdResponse200")


@_attrs_define
class PatchApiGroupsByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
    """

    id: str
    name: str
    slug: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        patch_api_groups_by_id_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
        )

        return patch_api_groups_by_id_response_200
