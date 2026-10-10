from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.put_api_prompts_by_id_response_200_inputs_item_type import PutApiPromptsByIdResponse200InputsItemType

T = TypeVar("T", bound="PutApiPromptsByIdResponse200InputsItem")


@_attrs_define
class PutApiPromptsByIdResponse200InputsItem:
    """
    Attributes:
        identifier (str):
        type_ (PutApiPromptsByIdResponse200InputsItemType):
    """

    identifier: str
    type_: PutApiPromptsByIdResponse200InputsItemType

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

        type_ = PutApiPromptsByIdResponse200InputsItemType(d.pop("type"))

        put_api_prompts_by_id_response_200_inputs_item = cls(
            identifier=identifier,
            type_=type_,
        )

        return put_api_prompts_by_id_response_200_inputs_item
