from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.get_api_dataset_response_200_data_item_column_types_item import (
        GetApiDatasetResponse200DataItemColumnTypesItem,
    )


T = TypeVar("T", bound="GetApiDatasetResponse200DataItem")


@_attrs_define
class GetApiDatasetResponse200DataItem:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        column_types (list[GetApiDatasetResponse200DataItemColumnTypesItem]):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        platform_url (str):
        record_count (int):
    """

    id: str
    name: str
    slug: str
    column_types: list[GetApiDatasetResponse200DataItemColumnTypesItem]
    created_at: datetime.datetime
    updated_at: datetime.datetime
    platform_url: str
    record_count: int

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

        platform_url = self.platform_url

        record_count = self.record_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "columnTypes": column_types,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
                "recordCount": record_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_response_200_data_item_column_types_item import (
            GetApiDatasetResponse200DataItemColumnTypesItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = GetApiDatasetResponse200DataItemColumnTypesItem.from_dict(column_types_item_data)

            column_types.append(column_types_item)

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        platform_url = d.pop("platformUrl")

        record_count = d.pop("recordCount")

        get_api_dataset_response_200_data_item = cls(
            id=id,
            name=name,
            slug=slug,
            column_types=column_types,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
            record_count=record_count,
        )

        return get_api_dataset_response_200_data_item
