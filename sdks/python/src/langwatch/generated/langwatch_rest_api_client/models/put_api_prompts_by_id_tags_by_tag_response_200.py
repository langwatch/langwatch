from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PutApiPromptsByIdTagsByTagResponse200")


@_attrs_define
class PutApiPromptsByIdTagsByTagResponse200:
    """
    Attributes:
        config_id (str):
        version_id (str):
        tag (str):
        updated_at (str):
    """

    config_id: str
    version_id: str
    tag: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        config_id = self.config_id

        version_id = self.version_id

        tag = self.tag

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "configId": config_id,
                "versionId": version_id,
                "tag": tag,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        config_id = d.pop("configId")

        version_id = d.pop("versionId")

        tag = d.pop("tag")

        updated_at = d.pop("updatedAt")

        put_api_prompts_by_id_tags_by_tag_response_200 = cls(
            config_id=config_id,
            version_id=version_id,
            tag=tag,
            updated_at=updated_at,
        )

        return put_api_prompts_by_id_tags_by_tag_response_200
