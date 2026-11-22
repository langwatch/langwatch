from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format_type import (
    PostApiPromptsByIdSyncResponse200PromptResponseFormatType,
)

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0 import (
        PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200PromptResponseFormat")


@_attrs_define
class PostApiPromptsByIdSyncResponse200PromptResponseFormat:
    """
    Attributes:
        type_ (PostApiPromptsByIdSyncResponse200PromptResponseFormatType):
        json_schema (None | PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0):
    """

    type_: PostApiPromptsByIdSyncResponse200PromptResponseFormatType
    json_schema: None | PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0 import (
            PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0,
        )

        type_ = self.type_.value

        json_schema: dict[str, Any] | None
        if isinstance(self.json_schema, PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0):
            json_schema = self.json_schema.to_dict()
        else:
            json_schema = self.json_schema

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "json_schema": json_schema,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0 import (
            PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsByIdSyncResponse200PromptResponseFormatType(d.pop("type"))

        def _parse_json_schema(
            data: object,
        ) -> None | PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                json_schema_type_0 = PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0.from_dict(
                    data
                )

                return json_schema_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0, data)

        json_schema = _parse_json_schema(d.pop("json_schema"))

        post_api_prompts_by_id_sync_response_200_prompt_response_format = cls(
            type_=type_,
            json_schema=json_schema,
        )

        return post_api_prompts_by_id_sync_response_200_prompt_response_format
