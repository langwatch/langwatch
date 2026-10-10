from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_response_200_messages_item_role import PostApiPromptsResponse200MessagesItemRole

T = TypeVar("T", bound="PostApiPromptsResponse200MessagesItem")


@_attrs_define
class PostApiPromptsResponse200MessagesItem:
    """
    Attributes:
        role (PostApiPromptsResponse200MessagesItemRole):
        content (str):
    """

    role: PostApiPromptsResponse200MessagesItemRole
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
        role = PostApiPromptsResponse200MessagesItemRole(d.pop("role"))

        content = d.pop("content")

        post_api_prompts_response_200_messages_item = cls(
            role=role,
            content=content,
        )

        return post_api_prompts_response_200_messages_item
