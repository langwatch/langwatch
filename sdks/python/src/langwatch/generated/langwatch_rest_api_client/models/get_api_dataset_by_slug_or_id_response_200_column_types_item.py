from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_dataset_by_slug_or_id_response_200_column_types_item_type import (
    GetApiDatasetBySlugOrIdResponse200ColumnTypesItemType,
)

T = TypeVar("T", bound="GetApiDatasetBySlugOrIdResponse200ColumnTypesItem")


@_attrs_define
class GetApiDatasetBySlugOrIdResponse200ColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (GetApiDatasetBySlugOrIdResponse200ColumnTypesItemType):
    """

    name: str
    type_: GetApiDatasetBySlugOrIdResponse200ColumnTypesItemType

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

        type_ = GetApiDatasetBySlugOrIdResponse200ColumnTypesItemType(d.pop("type"))

        get_api_dataset_by_slug_or_id_response_200_column_types_item = cls(
            name=name,
            type_=type_,
        )

        return get_api_dataset_by_slug_or_id_response_200_column_types_item
