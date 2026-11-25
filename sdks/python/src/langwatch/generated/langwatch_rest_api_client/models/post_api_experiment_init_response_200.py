from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiExperimentInitResponse200")


@_attrs_define
class PostApiExperimentInitResponse200:
    """
    Attributes:
        slug (str): Slug of the experiment, created or existing
        path (str): Path to the experiment in the LangWatch app
    """

    slug: str
    path: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        slug = d.pop("slug")

        path = d.pop("path")

        post_api_experiment_init_response_200 = cls(
            slug=slug,
            path=path,
        )

        return post_api_experiment_init_response_200
