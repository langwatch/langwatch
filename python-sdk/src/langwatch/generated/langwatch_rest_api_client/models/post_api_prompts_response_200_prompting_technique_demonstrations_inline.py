from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        column_types (list['PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineColumnTypesItem']):
    """

    records: "PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineRecords"
    column_types: list["PostApiPromptsResponse200PromptingTechniqueDemonstrationsInlineColumnTypesItem"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        records = self.records.to_dict()

        column_types = []
        for column_types_item_data in self.column_types:
            column_types_item = column_types_item_data.to_dict()
            column_types.append(column_types_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_prompts_response_200_prompting_technique_demonstrations_inline.additional_properties = d
        return post_api_prompts_response_200_prompting_technique_demonstrations_inline

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
