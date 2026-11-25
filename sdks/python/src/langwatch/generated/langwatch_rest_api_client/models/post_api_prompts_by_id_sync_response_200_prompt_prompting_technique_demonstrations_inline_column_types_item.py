from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations_inline_column_types_item_type import (
    PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInlineColumnTypesItemType,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInlineColumnTypesItem")


@_attrs_define
class PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInlineColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInlineColumnTypesItemType):
        id (str | Unset):
    """

    name: str
    type_: PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInlineColumnTypesItemType
    id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        id = self.id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInlineColumnTypesItemType(
            d.pop("type")
        )

        id = d.pop("id", UNSET)

        post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations_inline_column_types_item = (
            cls(
                name=name,
                type_=type_,
                id=id,
            )
        )

        return (
            post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations_inline_column_types_item
        )
