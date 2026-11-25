from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_response_200_outputs_item_type import PostApiPromptsResponse200OutputsItemType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_response_200_outputs_item_json_schema import (
        PostApiPromptsResponse200OutputsItemJsonSchema,
    )


T = TypeVar("T", bound="PostApiPromptsResponse200OutputsItem")


@_attrs_define
class PostApiPromptsResponse200OutputsItem:
    """
    Attributes:
        identifier (str):
        type_ (PostApiPromptsResponse200OutputsItemType):
        json_schema (PostApiPromptsResponse200OutputsItemJsonSchema | Unset):
    """

    identifier: str
    type_: PostApiPromptsResponse200OutputsItemType
    json_schema: PostApiPromptsResponse200OutputsItemJsonSchema | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        json_schema: dict[str, Any] | Unset = UNSET
        if not isinstance(self.json_schema, Unset):
            json_schema = self.json_schema.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )
        if json_schema is not UNSET:
            field_dict["json_schema"] = json_schema

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_response_200_outputs_item_json_schema import (
            PostApiPromptsResponse200OutputsItemJsonSchema,
        )

        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = PostApiPromptsResponse200OutputsItemType(d.pop("type"))

        _json_schema = d.pop("json_schema", UNSET)
        json_schema: PostApiPromptsResponse200OutputsItemJsonSchema | Unset
        if isinstance(_json_schema, Unset):
            json_schema = UNSET
        else:
            json_schema = PostApiPromptsResponse200OutputsItemJsonSchema.from_dict(_json_schema)

        post_api_prompts_response_200_outputs_item = cls(
            identifier=identifier,
            type_=type_,
            json_schema=json_schema,
        )

        return post_api_prompts_response_200_outputs_item
