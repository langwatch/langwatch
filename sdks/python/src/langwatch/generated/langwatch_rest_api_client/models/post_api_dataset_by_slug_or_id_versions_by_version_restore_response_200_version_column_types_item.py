from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version_column_types_item_type import (
    PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItemType,
)

T = TypeVar("T", bound="PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItem")


@_attrs_define
class PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItemType):
    """

    name: str
    type_: PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItemType

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

        type_ = PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItemType(d.pop("type"))

        post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version_column_types_item = cls(
            name=name,
            type_=type_,
        )

        return post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version_column_types_item
