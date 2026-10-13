from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiMeProjectResponse200")


@_attrs_define
class GetApiMeProjectResponse200:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        is_personal (bool):
    """

    id: str
    name: str
    slug: str
    is_personal: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        is_personal = self.is_personal

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "isPersonal": is_personal,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        is_personal = d.pop("isPersonal")

        get_api_me_project_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
            is_personal=is_personal,
        )

        return get_api_me_project_response_200
