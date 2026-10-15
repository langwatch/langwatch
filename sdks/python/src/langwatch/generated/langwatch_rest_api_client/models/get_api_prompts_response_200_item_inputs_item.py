from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_prompts_response_200_item_inputs_item_type import GetApiPromptsResponse200ItemInputsItemType

T = TypeVar("T", bound="GetApiPromptsResponse200ItemInputsItem")


@_attrs_define
class GetApiPromptsResponse200ItemInputsItem:
    """
    Attributes:
        identifier (str):
        type_ (GetApiPromptsResponse200ItemInputsItemType):
    """

    identifier: str
    type_: GetApiPromptsResponse200ItemInputsItemType

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

        type_ = GetApiPromptsResponse200ItemInputsItemType(d.pop("type"))

        get_api_prompts_response_200_item_inputs_item = cls(
            identifier=identifier,
            type_=type_,
        )

        return get_api_prompts_response_200_item_inputs_item
