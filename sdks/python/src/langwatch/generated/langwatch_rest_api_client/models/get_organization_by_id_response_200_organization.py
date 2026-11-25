from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="GetOrganizationByIdResponse200Organization")


@_attrs_define
class GetOrganizationByIdResponse200Organization:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        created_at (datetime.datetime):
    """

    id: str
    name: str
    slug: str
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        created_at = isoparse(d.pop("createdAt"))

        get_organization_by_id_response_200_organization = cls(
            id=id,
            name=name,
            slug=slug,
            created_at=created_at,
        )

        return get_organization_by_id_response_200_organization
