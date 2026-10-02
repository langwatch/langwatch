from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_messages_item_role import (
    PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItemRole,
)

T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItem")


@_attrs_define
class PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItem:
    """
    Attributes:
        role (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItemRole):
        content (str):
    """

    role: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItemRole
    content: str

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        content = self.content

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "role": role,
                "content": content,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataMessagesItemRole(d.pop("role"))

        content = d.pop("content")

        post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_messages_item = cls(
            role=role,
            content=content,
        )

        return post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_messages_item
