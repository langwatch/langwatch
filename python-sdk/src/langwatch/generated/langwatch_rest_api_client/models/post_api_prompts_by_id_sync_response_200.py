from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        prompt (Union[Unset, PostApiPromptsByIdSyncResponse200Prompt]):
        conflict_info (Union[Unset, PostApiPromptsByIdSyncResponse200ConflictInfo]):
    """

    action: PostApiPromptsByIdSyncResponse200Action
    prompt: Union[Unset, "PostApiPromptsByIdSyncResponse200Prompt"] = UNSET
    conflict_info: Union[Unset, "PostApiPromptsByIdSyncResponse200ConflictInfo"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        action = self.action.value

        prompt: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.prompt, Unset):
            prompt = self.prompt.to_dict()

        conflict_info: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.conflict_info, Unset):
            conflict_info = self.conflict_info.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        prompt: Union[Unset, PostApiPromptsByIdSyncResponse200Prompt]
        if isinstance(_prompt, Unset):
            prompt = UNSET
        else:
            prompt = PostApiPromptsByIdSyncResponse200Prompt.from_dict(_prompt)

        _conflict_info = d.pop("conflictInfo", UNSET)
        conflict_info: Union[Unset, PostApiPromptsByIdSyncResponse200ConflictInfo]
        if isinstance(_conflict_info, Unset):
            conflict_info = UNSET
        else:
            conflict_info = PostApiPromptsByIdSyncResponse200ConflictInfo.from_dict(_conflict_info)

        post_api_prompts_by_id_sync_response_200 = cls(
            action=action,
            prompt=prompt,
            conflict_info=conflict_info,
        )

        post_api_prompts_by_id_sync_response_200.additional_properties = d
        return post_api_prompts_by_id_sync_response_200

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
