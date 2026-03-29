from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0_schema import (
        PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0Schema,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0")


@_attrs_define
class PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0:
    """
    Attributes:
        name (str):
        schema (PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0Schema):
    """

    name: str
    schema: "PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0Schema"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        schema = self.schema.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "schema": schema,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0_schema import (
            PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0Schema,
        )

        d = dict(src_dict)
        name = d.pop("name")

        schema = PostApiPromptsByIdSyncResponse200PromptResponseFormatJsonSchemaType0Schema.from_dict(d.pop("schema"))

        post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0 = cls(
            name=name,
            schema=schema,
        )

        post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0.additional_properties = d
        return post_api_prompts_by_id_sync_response_200_prompt_response_format_json_schema_type_0

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
