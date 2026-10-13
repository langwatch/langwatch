from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_by_id_sync_response_200_prompt_inputs_item_type import (
    PostApiPromptsByIdSyncResponse200PromptInputsItemType,
)

T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200PromptInputsItem")


@_attrs_define
class PostApiPromptsByIdSyncResponse200PromptInputsItem:
    """
    Attributes:
        identifier (str):
        type_ (PostApiPromptsByIdSyncResponse200PromptInputsItemType):
    """

    identifier: str
    type_: PostApiPromptsByIdSyncResponse200PromptInputsItemType

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = PostApiPromptsByIdSyncResponse200PromptInputsItemType(d.pop("type"))

        post_api_prompts_by_id_sync_response_200_prompt_inputs_item = cls(
            identifier=identifier,
            type_=type_,
        )

        return post_api_prompts_by_id_sync_response_200_prompt_inputs_item
