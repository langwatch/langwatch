from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_prompts_by_id_response_200_response_format_type import (
    PutApiPromptsByIdResponse200ResponseFormatType,
)

if TYPE_CHECKING:
    from ..models.put_api_prompts_by_id_response_200_response_format_json_schema_type_0 import (
        PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0,
    )


T = TypeVar("T", bound="PutApiPromptsByIdResponse200ResponseFormat")


@_attrs_define
class PutApiPromptsByIdResponse200ResponseFormat:
    """
    Attributes:
        type_ (PutApiPromptsByIdResponse200ResponseFormatType):
        json_schema (Union['PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0', None]):
    """

    type_: PutApiPromptsByIdResponse200ResponseFormatType
    json_schema: Union["PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0", None]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.put_api_prompts_by_id_response_200_response_format_json_schema_type_0 import (
            PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0,
        )

        type_ = self.type_.value

        json_schema: Union[None, dict[str, Any]]
        if isinstance(self.json_schema, PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0):
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
        from ..models.put_api_prompts_by_id_response_200_response_format_json_schema_type_0 import (
            PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0,
        )

        d = dict(src_dict)
        type_ = PutApiPromptsByIdResponse200ResponseFormatType(d.pop("type"))

        def _parse_json_schema(
            data: object,
        ) -> Union["PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                json_schema_type_0 = PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0.from_dict(data)

                return json_schema_type_0
            except:  # noqa: E722
                pass
            return cast(Union["PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0", None], data)

        json_schema = _parse_json_schema(d.pop("json_schema"))

        put_api_prompts_by_id_response_200_response_format = cls(
            type_=type_,
            json_schema=json_schema,
        )

        put_api_prompts_by_id_response_200_response_format.additional_properties = d
        return put_api_prompts_by_id_response_200_response_format

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
