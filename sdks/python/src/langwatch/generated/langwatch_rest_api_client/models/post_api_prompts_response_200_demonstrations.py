from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_response_200_demonstrations_inline import (
        PostApiPromptsResponse200DemonstrationsInline,
    )


T = TypeVar("T", bound="PostApiPromptsResponse200Demonstrations")


@_attrs_define
class PostApiPromptsResponse200Demonstrations:
    """
    Attributes:
        id (str | Unset):
        name (str | Unset):
        inline (PostApiPromptsResponse200DemonstrationsInline | Unset):
    """

    id: str | Unset = UNSET
    name: str | Unset = UNSET
    inline: PostApiPromptsResponse200DemonstrationsInline | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        inline: dict[str, Any] | Unset = UNSET
        if not isinstance(self.inline, Unset):
            inline = self.inline.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if inline is not UNSET:
            field_dict["inline"] = inline

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_response_200_demonstrations_inline import (
            PostApiPromptsResponse200DemonstrationsInline,
        )

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        _inline = d.pop("inline", UNSET)
        inline: PostApiPromptsResponse200DemonstrationsInline | Unset
        if isinstance(_inline, Unset):
            inline = UNSET
        else:
            inline = PostApiPromptsResponse200DemonstrationsInline.from_dict(_inline)

        post_api_prompts_response_200_demonstrations = cls(
            id=id,
            name=name,
            inline=inline,
        )

        return post_api_prompts_response_200_demonstrations
