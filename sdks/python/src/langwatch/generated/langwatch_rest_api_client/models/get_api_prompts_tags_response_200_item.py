from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiPromptsTagsResponse200Item")


@_attrs_define
class GetApiPromptsTagsResponse200Item:
    """
    Attributes:
        id (str):
        name (str):
        created_at (str):
    """

    id: str
    name: str
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        created_at = self.created_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        created_at = d.pop("createdAt")

        get_api_prompts_tags_response_200_item = cls(
            id=id,
            name=name,
            created_at=created_at,
        )

        return get_api_prompts_tags_response_200_item
