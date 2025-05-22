from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_prompts_response_200_response_format_type_0_type import (
    PostApiPromptsResponse200ResponseFormatType0Type,
)

if TYPE_CHECKING:
    from ..models.post_api_prompts_response_200_response_format_type_0_json_schema import (
        PostApiPromptsResponse200ResponseFormatType0JsonSchema,
    )


T = TypeVar("T", bound="PostApiPromptsResponse200ResponseFormatType0")


@_attrs_define
class PostApiPromptsResponse200ResponseFormatType0:
    """
    Attributes:
        type_ (PostApiPromptsResponse200ResponseFormatType0Type):
        json_schema (PostApiPromptsResponse200ResponseFormatType0JsonSchema):
    """

    type_: PostApiPromptsResponse200ResponseFormatType0Type
    json_schema: "PostApiPromptsResponse200ResponseFormatType0JsonSchema"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        json_schema = self.json_schema.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "json_schema": json_schema,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_response_200_response_format_type_0_json_schema import (
            PostApiPromptsResponse200ResponseFormatType0JsonSchema,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsResponse200ResponseFormatType0Type(d.pop("type"))

        json_schema = PostApiPromptsResponse200ResponseFormatType0JsonSchema.from_dict(d.pop("json_schema"))

        post_api_prompts_response_200_response_format_type_0 = cls(
            type_=type_,
            json_schema=json_schema,
        )

        post_api_prompts_response_200_response_format_type_0.additional_properties = d
        return post_api_prompts_response_200_response_format_type_0

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
