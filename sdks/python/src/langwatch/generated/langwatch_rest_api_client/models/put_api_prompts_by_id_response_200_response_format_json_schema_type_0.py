from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.put_api_prompts_by_id_response_200_response_format_json_schema_type_0_schema import (
        PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0Schema,
    )


T = TypeVar("T", bound="PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0")


@_attrs_define
class PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0:
    """
    Attributes:
        name (str):
        schema (PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0Schema):
    """

    name: str
    schema: PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0Schema

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
        from ..models.put_api_prompts_by_id_response_200_response_format_json_schema_type_0_schema import (
            PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0Schema,
        )

        d = dict(src_dict)
        name = d.pop("name")

        schema = PutApiPromptsByIdResponse200ResponseFormatJsonSchemaType0Schema.from_dict(d.pop("schema"))

        put_api_prompts_by_id_response_200_response_format_json_schema_type_0 = cls(
            name=name,
            schema=schema,
        )

        return put_api_prompts_by_id_response_200_response_format_json_schema_type_0
