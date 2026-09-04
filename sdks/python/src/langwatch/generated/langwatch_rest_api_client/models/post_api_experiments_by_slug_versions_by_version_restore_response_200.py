from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiExperimentsBySlugVersionsByVersionRestoreResponse200")


@_attrs_define
class PostApiExperimentsBySlugVersionsByVersionRestoreResponse200:
    """
    Attributes:
        version (float): The new version the restore wrote. History is never rewritten, so the restored version is still
            in the list.
    """

    version: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_experiments_by_slug_versions_by_version_restore_response_200.additional_properties = d
        return post_api_experiments_by_slug_versions_by_version_restore_response_200

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
