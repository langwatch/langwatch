from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_response_200_item_response_format_type import (
    GetApiPromptsResponse200ItemResponseFormatType,
)

if TYPE_CHECKING:
    from ..models.get_api_prompts_response_200_item_response_format_json_schema_type_0 import (
        GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0,
    )


T = TypeVar("T", bound="GetApiPromptsResponse200ItemResponseFormat")


@_attrs_define
class GetApiPromptsResponse200ItemResponseFormat:
    """
    Attributes:
        type_ (GetApiPromptsResponse200ItemResponseFormatType):
        json_schema (Union['GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0', None]):
    """

    type_: GetApiPromptsResponse200ItemResponseFormatType
    json_schema: Union["GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0", None]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_prompts_response_200_item_response_format_json_schema_type_0 import (
            GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0,
        )

        type_ = self.type_.value

        json_schema: Union[None, dict[str, Any]]
        if isinstance(self.json_schema, GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0):
            json_schema = self.json_schema.to_dict()
        else:
            json_schema = self.json_schema

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
        from ..models.get_api_prompts_response_200_item_response_format_json_schema_type_0 import (
            GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0,
        )

        d = dict(src_dict)
        type_ = GetApiPromptsResponse200ItemResponseFormatType(d.pop("type"))

        def _parse_json_schema(
            data: object,
        ) -> Union["GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                json_schema_type_0 = GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0.from_dict(data)

                return json_schema_type_0
            except:  # noqa: E722
                pass
            return cast(Union["GetApiPromptsResponse200ItemResponseFormatJsonSchemaType0", None], data)

        json_schema = _parse_json_schema(d.pop("json_schema"))

        get_api_prompts_response_200_item_response_format = cls(
            type_=type_,
            json_schema=json_schema,
        )

        get_api_prompts_response_200_item_response_format.additional_properties = d
        return get_api_prompts_response_200_item_response_format

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
