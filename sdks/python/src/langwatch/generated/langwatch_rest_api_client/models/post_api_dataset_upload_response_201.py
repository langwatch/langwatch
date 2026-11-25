from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.post_api_dataset_upload_response_201_column_types_item import (
        PostApiDatasetUploadResponse201ColumnTypesItem,
    )


T = TypeVar("T", bound="PostApiDatasetUploadResponse201")


@_attrs_define
class PostApiDatasetUploadResponse201:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        column_types (list[PostApiDatasetUploadResponse201ColumnTypesItem]):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        records_created (int):
    """

    id: str
    name: str
    slug: str
    column_types: list[PostApiDatasetUploadResponse201ColumnTypesItem]
    created_at: datetime.datetime
    updated_at: datetime.datetime
    records_created: int

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        column_types = []
        for column_types_item_data in self.column_types:
            column_types_item = column_types_item_data.to_dict()
            column_types.append(column_types_item)

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        records_created = self.records_created

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "columnTypes": column_types,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "recordsCreated": records_created,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_upload_response_201_column_types_item import (
            PostApiDatasetUploadResponse201ColumnTypesItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = PostApiDatasetUploadResponse201ColumnTypesItem.from_dict(column_types_item_data)

            column_types.append(column_types_item)

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        records_created = d.pop("recordsCreated")

        post_api_dataset_upload_response_201 = cls(
            id=id,
            name=name,
            slug=slug,
            column_types=column_types,
            created_at=created_at,
            updated_at=updated_at,
            records_created=records_created,
        )

        return post_api_dataset_upload_response_201
