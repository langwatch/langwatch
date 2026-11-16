from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_by_id_sync_response_200_action import PostApiPromptsByIdSyncResponse200Action
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info import (
        PostApiPromptsByIdSyncResponse200ConflictInfo,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_prompt import PostApiPromptsByIdSyncResponse200Prompt


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200")


@_attrs_define
class PostApiPromptsByIdSyncResponse200:
    """
    Attributes:
        action (PostApiPromptsByIdSyncResponse200Action):
        prompt (PostApiPromptsByIdSyncResponse200Prompt | Unset):
        conflict_info (PostApiPromptsByIdSyncResponse200ConflictInfo | Unset):
    """

    action: PostApiPromptsByIdSyncResponse200Action
    prompt: PostApiPromptsByIdSyncResponse200Prompt | Unset = UNSET
    conflict_info: PostApiPromptsByIdSyncResponse200ConflictInfo | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        action = self.action.value

        prompt: dict[str, Any] | Unset = UNSET
        if not isinstance(self.prompt, Unset):
            prompt = self.prompt.to_dict()

        conflict_info: dict[str, Any] | Unset = UNSET
        if not isinstance(self.conflict_info, Unset):
            conflict_info = self.conflict_info.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "action": action,
            }
        )
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if conflict_info is not UNSET:
            field_dict["conflictInfo"] = conflict_info

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info import (
            PostApiPromptsByIdSyncResponse200ConflictInfo,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_prompt import PostApiPromptsByIdSyncResponse200Prompt

        d = dict(src_dict)
        action = PostApiPromptsByIdSyncResponse200Action(d.pop("action"))

        _prompt = d.pop("prompt", UNSET)
        prompt: PostApiPromptsByIdSyncResponse200Prompt | Unset
        if isinstance(_prompt, Unset):
            prompt = UNSET
        else:
            prompt = PostApiPromptsByIdSyncResponse200Prompt.from_dict(_prompt)

        _conflict_info = d.pop("conflictInfo", UNSET)
        conflict_info: PostApiPromptsByIdSyncResponse200ConflictInfo | Unset
        if isinstance(_conflict_info, Unset):
            conflict_info = UNSET
        else:
            conflict_info = PostApiPromptsByIdSyncResponse200ConflictInfo.from_dict(_conflict_info)

        post_api_prompts_by_id_sync_response_200 = cls(
            action=action,
            prompt=prompt,
            conflict_info=conflict_info,
        )

        return post_api_prompts_by_id_sync_response_200
