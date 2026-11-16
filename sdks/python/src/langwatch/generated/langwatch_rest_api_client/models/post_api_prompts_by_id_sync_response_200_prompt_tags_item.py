from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200PromptTagsItem")


@_attrs_define
class PostApiPromptsByIdSyncResponse200PromptTagsItem:
    """
    Attributes:
        name (str):
        version_id (str):
    """

    name: str
    version_id: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        version_id = self.version_id

        field_dict: dict[str, Any] = {}

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

        post_api_prompts_by_id_sync_response_200_prompt_tags_item = cls(
            name=name,
            version_id=version_id,
        )

        return post_api_prompts_by_id_sync_response_200_prompt_tags_item
