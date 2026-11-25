from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiExperimentsBySlugVersionsByVersionRestoreResponse200")


@_attrs_define
class PostApiExperimentsBySlugVersionsByVersionRestoreResponse200:
    """
    Attributes:
        version (float): The new version the restore wrote. History is never rewritten, so the restored version is still
            in the list.
    """

    version: float

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = d.pop("version")

        post_api_experiments_by_slug_versions_by_version_restore_response_200 = cls(
            version=version,
        )

        return post_api_experiments_by_slug_versions_by_version_restore_response_200
