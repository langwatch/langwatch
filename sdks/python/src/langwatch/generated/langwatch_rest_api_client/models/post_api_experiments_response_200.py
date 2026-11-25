from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiExperimentsResponse200")


@_attrs_define
class PostApiExperimentsResponse200:
    """
    Attributes:
        id (str): Identifier of the created experiment
        slug (str): Slug to address the experiment by
        version (float): Version of the saved setup, starting at 1
    """

    id: str
    slug: str
    version: float

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        slug = self.slug

        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        version = d.pop("version")

        post_api_experiments_response_200 = cls(
            id=id,
            slug=slug,
            version=version,
        )

        return post_api_experiments_response_200
