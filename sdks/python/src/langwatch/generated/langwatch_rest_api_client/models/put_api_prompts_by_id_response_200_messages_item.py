from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.put_api_prompts_by_id_response_200_messages_item_role import PutApiPromptsByIdResponse200MessagesItemRole

T = TypeVar("T", bound="PutApiPromptsByIdResponse200MessagesItem")


@_attrs_define
class PutApiPromptsByIdResponse200MessagesItem:
    """
    Attributes:
        role (PutApiPromptsByIdResponse200MessagesItemRole):
        content (str):
    """

    role: PutApiPromptsByIdResponse200MessagesItemRole
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
        role = PutApiPromptsByIdResponse200MessagesItemRole(d.pop("role"))

        content = d.pop("content")

        put_api_prompts_by_id_response_200_messages_item = cls(
            role=role,
            content=content,
        )

        return put_api_prompts_by_id_response_200_messages_item
