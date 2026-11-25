from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_dataset_upload_response_201_column_types_item_type import (
    PostApiDatasetUploadResponse201ColumnTypesItemType,
)

T = TypeVar("T", bound="PostApiDatasetUploadResponse201ColumnTypesItem")


@_attrs_define
class PostApiDatasetUploadResponse201ColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (PostApiDatasetUploadResponse201ColumnTypesItemType):
    """

    name: str
    type_: PostApiDatasetUploadResponse201ColumnTypesItemType

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

        type_ = PostApiDatasetUploadResponse201ColumnTypesItemType(d.pop("type"))

        post_api_dataset_upload_response_201_column_types_item = cls(
            name=name,
            type_=type_,
        )

        return post_api_dataset_upload_response_201_column_types_item
