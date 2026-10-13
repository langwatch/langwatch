from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_prompts_response_200_response_format_json_schema_type_0_schema import (
        PostApiPromptsResponse200ResponseFormatJsonSchemaType0Schema,
    )


T = TypeVar("T", bound="PostApiPromptsResponse200ResponseFormatJsonSchemaType0")


@_attrs_define
class PostApiPromptsResponse200ResponseFormatJsonSchemaType0:
    """
    Attributes:
        name (str):
        schema (PostApiPromptsResponse200ResponseFormatJsonSchemaType0Schema):
    """

    name: str
    schema: PostApiPromptsResponse200ResponseFormatJsonSchemaType0Schema

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        schema = self.schema.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "schema": schema,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_response_200_response_format_json_schema_type_0_schema import (
            PostApiPromptsResponse200ResponseFormatJsonSchemaType0Schema,
        )

        d = dict(src_dict)
        name = d.pop("name")

        schema = PostApiPromptsResponse200ResponseFormatJsonSchemaType0Schema.from_dict(d.pop("schema"))

        post_api_prompts_response_200_response_format_json_schema_type_0 = cls(
            name=name,
            schema=schema,
        )

        return post_api_prompts_response_200_response_format_json_schema_type_0
