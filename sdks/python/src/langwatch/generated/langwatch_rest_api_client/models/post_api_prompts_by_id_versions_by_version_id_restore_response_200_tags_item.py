from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiPromptsByIdVersionsByVersionIdRestoreResponse200TagsItem")


@_attrs_define
class PostApiPromptsByIdVersionsByVersionIdRestoreResponse200TagsItem:
    """
    Attributes:
        name (str):
        version_id (str):
    """

    name: str
    version_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        version_id = self.version_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "versionId": version_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        version_id = d.pop("versionId")

        post_api_prompts_by_id_versions_by_version_id_restore_response_200_tags_item = cls(
            name=name,
            version_id=version_id,
        )

        post_api_prompts_by_id_versions_by_version_id_restore_response_200_tags_item.additional_properties = d
        return post_api_prompts_by_id_versions_by_version_id_restore_response_200_tags_item

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
