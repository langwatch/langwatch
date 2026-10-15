from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_prompts_by_id_response_200_messages_item_role import GetApiPromptsByIdResponse200MessagesItemRole

T = TypeVar("T", bound="GetApiPromptsByIdResponse200MessagesItem")


@_attrs_define
class GetApiPromptsByIdResponse200MessagesItem:
    """
    Attributes:
        role (GetApiPromptsByIdResponse200MessagesItemRole):
        content (str):
    """

    role: GetApiPromptsByIdResponse200MessagesItemRole
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
        role = GetApiPromptsByIdResponse200MessagesItemRole(d.pop("role"))

        content = d.pop("content")

        get_api_prompts_by_id_response_200_messages_item = cls(
            role=role,
            content=content,
        )

        return get_api_prompts_by_id_response_200_messages_item
