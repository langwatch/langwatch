from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_prompts_response_200_response_format_type_0_json_schema_schema import (
        PostApiPromptsResponse200ResponseFormatType0JsonSchemaSchema,
    )


T = TypeVar("T", bound="PostApiPromptsResponse200ResponseFormatType0JsonSchema")


@_attrs_define
class PostApiPromptsResponse200ResponseFormatType0JsonSchema:
    """
    Attributes:
        name (str):
        schema (PostApiPromptsResponse200ResponseFormatType0JsonSchemaSchema):
    """

    name: str
    schema: "PostApiPromptsResponse200ResponseFormatType0JsonSchemaSchema"
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
        from ..models.post_api_prompts_response_200_response_format_type_0_json_schema_schema import (
            PostApiPromptsResponse200ResponseFormatType0JsonSchemaSchema,
        )

        d = dict(src_dict)
        name = d.pop("name")

        schema = PostApiPromptsResponse200ResponseFormatType0JsonSchemaSchema.from_dict(d.pop("schema"))

        post_api_prompts_response_200_response_format_type_0_json_schema = cls(
            name=name,
            schema=schema,
        )

        post_api_prompts_response_200_response_format_type_0_json_schema.additional_properties = d
        return post_api_prompts_response_200_response_format_type_0_json_schema

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
