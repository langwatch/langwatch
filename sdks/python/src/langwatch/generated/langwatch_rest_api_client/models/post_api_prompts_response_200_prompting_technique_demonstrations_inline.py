from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_prompts_response_200_prompting_technique_demonstrations_inline_column_types_item import (
        PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineColumnTypesItem,
    )
    from ..models.post_api_prompts_response_200_prompting_technique_demonstrations_inline_records import (
        PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineRecords,
    )


T = TypeVar("T", bound="PostApiPromptsResponse200PromptingTechniqueDemonstrationsInline")


@_attrs_define
class PostApiPromptsResponse200PromptingTechniqueDemonstrationsInline:
    """
    Attributes:
        records (PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineRecords):
        column_types (list[PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineColumnTypesItem]):
    """

    records: PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineRecords
    column_types: list[PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineColumnTypesItem]

    def to_dict(self) -> dict[str, Any]:
        records = self.records.to_dict()

        column_types = []
        for column_types_item_data in self.column_types:
            column_types_item = column_types_item_data.to_dict()
            column_types.append(column_types_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "records": records,
                "columnTypes": column_types,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_response_200_prompting_technique_demonstrations_inline_column_types_item import (
            PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineColumnTypesItem,
        )
        from ..models.post_api_prompts_response_200_prompting_technique_demonstrations_inline_records import (
            PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineRecords,
        )

        d = dict(src_dict)
        records = PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineRecords.from_dict(d.pop("records"))

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = (
                PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineColumnTypesItem.from_dict(
                    column_types_item_data
                )
            )

            column_types.append(column_types_item)

        post_api_prompts_response_200_prompting_technique_demonstrations_inline = cls(
            records=records,
            column_types=column_types,
        )

        return post_api_prompts_response_200_prompting_technique_demonstrations_inline
