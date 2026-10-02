from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiDatasetImportsResponse201")


@_attrs_define
class PostApiDatasetImportsResponse201:
    """
    Attributes:
        dataset_id (str):
        slug (str):
        status (Literal['processing']):
    """

    dataset_id: str
    slug: str
    status: Literal["processing"]

    def to_dict(self) -> dict[str, Any]:
        dataset_id = self.dataset_id

        slug = self.slug

        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "datasetId": dataset_id,
                "slug": slug,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        dataset_id = d.pop("datasetId")

        slug = d.pop("slug")

        status = cast(Literal["processing"], d.pop("status"))
        if status != "processing":
            raise ValueError(f"status must match const 'processing', got '{status}'")

        post_api_dataset_imports_response_201 = cls(
            dataset_id=dataset_id,
            slug=slug,
            status=status,
        )

        return post_api_dataset_imports_response_201
