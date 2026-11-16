from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_prompts_by_id_versions_response_200_item_outputs_item_type import (
    GetApiPromptsByIdVersionsResponse200ItemOutputsItemType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_prompts_by_id_versions_response_200_item_outputs_item_json_schema import (
        GetApiPromptsByIdVersionsResponse200ItemOutputsItemJsonSchema,
    )


T = TypeVar("T", bound="GetApiPromptsByIdVersionsResponse200ItemOutputsItem")


@_attrs_define
class GetApiPromptsByIdVersionsResponse200ItemOutputsItem:
    """
    Attributes:
        identifier (str):
        type_ (GetApiPromptsByIdVersionsResponse200ItemOutputsItemType):
        json_schema (GetApiPromptsByIdVersionsResponse200ItemOutputsItemJsonSchema | Unset):
    """

    identifier: str
    type_: GetApiPromptsByIdVersionsResponse200ItemOutputsItemType
    json_schema: GetApiPromptsByIdVersionsResponse200ItemOutputsItemJsonSchema | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        json_schema: dict[str, Any] | Unset = UNSET
        if not isinstance(self.json_schema, Unset):
            json_schema = self.json_schema.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )
        if json_schema is not UNSET:
            field_dict["json_schema"] = json_schema

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_prompts_by_id_versions_response_200_item_outputs_item_json_schema import (
            GetApiPromptsByIdVersionsResponse200ItemOutputsItemJsonSchema,
        )

        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = GetApiPromptsByIdVersionsResponse200ItemOutputsItemType(d.pop("type"))

        _json_schema = d.pop("json_schema", UNSET)
        json_schema: GetApiPromptsByIdVersionsResponse200ItemOutputsItemJsonSchema | Unset
        if isinstance(_json_schema, Unset):
            json_schema = UNSET
        else:
            json_schema = GetApiPromptsByIdVersionsResponse200ItemOutputsItemJsonSchema.from_dict(_json_schema)

        get_api_prompts_by_id_versions_response_200_item_outputs_item = cls(
            identifier=identifier,
            type_=type_,
            json_schema=json_schema,
        )

        return get_api_prompts_by_id_versions_response_200_item_outputs_item
