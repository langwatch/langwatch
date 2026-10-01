from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiDatasetBySlugOrIdUploadResponse200")


@_attrs_define
class PostApiDatasetBySlugOrIdUploadResponse200:
    """
    Attributes:
        dataset_id (str):
        records_created (int):
    """

    dataset_id: str
    records_created: int

    def to_dict(self) -> dict[str, Any]:
        dataset_id = self.dataset_id

        records_created = self.records_created

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "datasetId": dataset_id,
                "recordsCreated": records_created,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        dataset_id = d.pop("datasetId")

        records_created = d.pop("recordsCreated")

        post_api_dataset_by_slug_or_id_upload_response_200 = cls(
            dataset_id=dataset_id,
            records_created=records_created,
        )

        return post_api_dataset_by_slug_or_id_upload_response_200
