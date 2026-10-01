from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_dataset_response_200_data_item_column_types_item_type import (
    GetApiDatasetResponse200DataItemColumnTypesItemType,
)

T = TypeVar("T", bound="GetApiDatasetResponse200DataItemColumnTypesItem")


@_attrs_define
class GetApiDatasetResponse200DataItemColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (GetApiDatasetResponse200DataItemColumnTypesItemType):
    """

    name: str
    type_: GetApiDatasetResponse200DataItemColumnTypesItemType

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

        type_ = GetApiDatasetResponse200DataItemColumnTypesItemType(d.pop("type"))

        get_api_dataset_response_200_data_item_column_types_item = cls(
            name=name,
            type_=type_,
        )

        return get_api_dataset_response_200_data_item_column_types_item
