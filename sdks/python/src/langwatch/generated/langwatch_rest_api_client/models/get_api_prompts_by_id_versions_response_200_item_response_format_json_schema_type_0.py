from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_prompts_by_id_versions_response_200_item_response_format_json_schema_type_0_schema import (
        GetApiPromptsByIdVersionsResponse200ItemResponseFormatJsonSchemaType0Schema,
    )


T = TypeVar("T", bound="GetApiPromptsByIdVersionsResponse200ItemResponseFormatJsonSchemaType0")


@_attrs_define
class GetApiPromptsByIdVersionsResponse200ItemResponseFormatJsonSchemaType0:
    """
    Attributes:
        name (str):
        schema (GetApiPromptsByIdVersionsResponse200ItemResponseFormatJsonSchemaType0Schema):
    """

    name: str
    schema: GetApiPromptsByIdVersionsResponse200ItemResponseFormatJsonSchemaType0Schema

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
        from ..models.get_api_prompts_by_id_versions_response_200_item_response_format_json_schema_type_0_schema import (
            GetApiPromptsByIdVersionsResponse200ItemResponseFormatJsonSchemaType0Schema,
        )

        d = dict(src_dict)
        name = d.pop("name")

        schema = GetApiPromptsByIdVersionsResponse200ItemResponseFormatJsonSchemaType0Schema.from_dict(d.pop("schema"))

        get_api_prompts_by_id_versions_response_200_item_response_format_json_schema_type_0 = cls(
            name=name,
            schema=schema,
        )

        return get_api_prompts_by_id_versions_response_200_item_response_format_json_schema_type_0
