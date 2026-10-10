from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_prompts_by_id_response_200_inputs_item_type import GetApiPromptsByIdResponse200InputsItemType

T = TypeVar("T", bound="GetApiPromptsByIdResponse200InputsItem")


@_attrs_define
class GetApiPromptsByIdResponse200InputsItem:
    """
    Attributes:
        identifier (str):
        type_ (GetApiPromptsByIdResponse200InputsItemType):
    """

    identifier: str
    type_: GetApiPromptsByIdResponse200InputsItemType

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = GetApiPromptsByIdResponse200InputsItemType(d.pop("type"))

        get_api_prompts_by_id_response_200_inputs_item = cls(
            identifier=identifier,
            type_=type_,
        )

        return get_api_prompts_by_id_response_200_inputs_item
