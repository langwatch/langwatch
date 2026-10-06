from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_dataset_by_slug_entries_response_200_dataset_column_types_item_type import (
    GetApiDatasetBySlugEntriesResponse200DatasetColumnTypesItemType,
)

T = TypeVar("T", bound="GetApiDatasetBySlugEntriesResponse200DatasetColumnTypesItem")


@_attrs_define
class GetApiDatasetBySlugEntriesResponse200DatasetColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (GetApiDatasetBySlugEntriesResponse200DatasetColumnTypesItemType):
    """

    name: str
    type_: GetApiDatasetBySlugEntriesResponse200DatasetColumnTypesItemType

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = GetApiDatasetBySlugEntriesResponse200DatasetColumnTypesItemType(d.pop("type"))

        get_api_dataset_by_slug_entries_response_200_dataset_column_types_item = cls(
            name=name,
            type_=type_,
        )

        return get_api_dataset_by_slug_entries_response_200_dataset_column_types_item
