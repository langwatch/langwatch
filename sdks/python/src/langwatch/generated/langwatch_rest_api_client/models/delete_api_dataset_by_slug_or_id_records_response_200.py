from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteApiDatasetBySlugOrIdRecordsResponse200")


@_attrs_define
class DeleteApiDatasetBySlugOrIdRecordsResponse200:
    """
    Attributes:
        deleted_count (int):
    """

    deleted_count: int

    def to_dict(self) -> dict[str, Any]:
        deleted_count = self.deleted_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "deletedCount": deleted_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        deleted_count = d.pop("deletedCount")

        delete_api_dataset_by_slug_or_id_records_response_200 = cls(
            deleted_count=deleted_count,
        )

        return delete_api_dataset_by_slug_or_id_records_response_200
