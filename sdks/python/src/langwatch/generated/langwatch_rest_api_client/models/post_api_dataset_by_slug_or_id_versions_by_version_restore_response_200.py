from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version import (
        PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200Version,
    )


T = TypeVar("T", bound="PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200")


@_attrs_define
class PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200:
    """
    Attributes:
        version (PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200Version):
        changed (bool):
    """

    version: PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200Version
    changed: bool

    def to_dict(self) -> dict[str, Any]:
        version = self.version.to_dict()

        changed = self.changed

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "changed": changed,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version import (
            PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200Version,
        )

        d = dict(src_dict)
        version = PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200Version.from_dict(d.pop("version"))

        changed = d.pop("changed")

        post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200 = cls(
            version=version,
            changed=changed,
        )

        return post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200
