from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.post_api_dataset_by_slug_or_id_records_response_201_data_item_entry import (
        PostApiDatasetBySlugOrIdRecordsResponse201DataItemEntry,
    )


T = TypeVar("T", bound="PostApiDatasetBySlugOrIdRecordsResponse201DataItem")


@_attrs_define
class PostApiDatasetBySlugOrIdRecordsResponse201DataItem:
    """
    Attributes:
        id (str):
        dataset_id (str):
        project_id (str):
        entry (PostApiDatasetBySlugOrIdRecordsResponse201DataItemEntry):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: str
    dataset_id: str
    project_id: str
    entry: PostApiDatasetBySlugOrIdRecordsResponse201DataItemEntry
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        dataset_id = self.dataset_id

        project_id = self.project_id

        entry = self.entry.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "datasetId": dataset_id,
                "projectId": project_id,
                "entry": entry,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_by_slug_or_id_records_response_201_data_item_entry import (
            PostApiDatasetBySlugOrIdRecordsResponse201DataItemEntry,
        )

        d = dict(src_dict)
        id = d.pop("id")

        dataset_id = d.pop("datasetId")

        project_id = d.pop("projectId")

        entry = PostApiDatasetBySlugOrIdRecordsResponse201DataItemEntry.from_dict(d.pop("entry"))

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        post_api_dataset_by_slug_or_id_records_response_201_data_item = cls(
            id=id,
            dataset_id=dataset_id,
            project_id=project_id,
            entry=entry,
            created_at=created_at,
            updated_at=updated_at,
        )

        return post_api_dataset_by_slug_or_id_records_response_201_data_item
