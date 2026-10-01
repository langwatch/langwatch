from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_prompts_by_id_response_200_demonstrations_inline_column_types_item_type import (
    PutApiPromptsByIdResponse200DemonstrationsInlineColumnTypesItemType,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PutApiPromptsByIdResponse200DemonstrationsInlineColumnTypesItem")


@_attrs_define
class PutApiPromptsByIdResponse200DemonstrationsInlineColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (PutApiPromptsByIdResponse200DemonstrationsInlineColumnTypesItemType):
        id (str | Unset):
    """

    name: str
    type_: PutApiPromptsByIdResponse200DemonstrationsInlineColumnTypesItemType
    id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        id = self.id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = PutApiPromptsByIdResponse200DemonstrationsInlineColumnTypesItemType(d.pop("type"))

        id = d.pop("id", UNSET)

        put_api_prompts_by_id_response_200_demonstrations_inline_column_types_item = cls(
            name=name,
            type_=type_,
            id=id,
        )

        put_api_prompts_by_id_response_200_demonstrations_inline_column_types_item.additional_properties = d
        return put_api_prompts_by_id_response_200_demonstrations_inline_column_types_item

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
