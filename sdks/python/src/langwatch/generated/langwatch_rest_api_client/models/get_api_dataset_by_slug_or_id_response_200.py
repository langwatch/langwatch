from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.get_api_dataset_by_slug_or_id_response_200_column_types_item import (
        GetApiDatasetBySlugOrIdResponse200ColumnTypesItem,
    )
    from ..models.get_api_dataset_by_slug_or_id_response_200_data_item import GetApiDatasetBySlugOrIdResponse200DataItem


T = TypeVar("T", bound="GetApiDatasetBySlugOrIdResponse200")


@_attrs_define
class GetApiDatasetBySlugOrIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        column_types (list[GetApiDatasetBySlugOrIdResponse200ColumnTypesItem]):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        platform_url (str):
        data (list[GetApiDatasetBySlugOrIdResponse200DataItem]):
    """

    id: str
    name: str
    slug: str
    column_types: list[GetApiDatasetBySlugOrIdResponse200ColumnTypesItem]
    created_at: datetime.datetime
    updated_at: datetime.datetime
    platform_url: str
    data: list[GetApiDatasetBySlugOrIdResponse200DataItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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

        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "columnTypes": column_types,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_by_slug_or_id_response_200_column_types_item import (
            GetApiDatasetBySlugOrIdResponse200ColumnTypesItem,
        )
        from ..models.get_api_dataset_by_slug_or_id_response_200_data_item import (
            GetApiDatasetBySlugOrIdResponse200DataItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = GetApiDatasetBySlugOrIdResponse200ColumnTypesItem.from_dict(column_types_item_data)

            column_types.append(column_types_item)

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        platform_url = d.pop("platformUrl")

        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiDatasetBySlugOrIdResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        get_api_dataset_by_slug_or_id_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
            column_types=column_types,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
            data=data,
        )

        get_api_dataset_by_slug_or_id_response_200.additional_properties = d
        return get_api_dataset_by_slug_or_id_response_200

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
