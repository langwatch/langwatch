from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiExperimentInitResponse200")


@_attrs_define
class PostApiExperimentInitResponse200:
    """
    Attributes:
        path (str):
        slug (str):
    """

    path: str
    slug: str

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        slug = self.slug

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
                "slug": slug,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        slug = d.pop("slug")

        post_api_experiment_init_response_200 = cls(
            path=path,
            slug=slug,
        )

        return post_api_experiment_init_response_200
