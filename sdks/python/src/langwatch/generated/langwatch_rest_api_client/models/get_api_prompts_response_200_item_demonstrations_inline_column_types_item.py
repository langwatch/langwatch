from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_response_200_item_demonstrations_inline_column_types_item_type import (
    GetApiPromptsResponse200ItemDemonstrationsInlineColumnTypesItemType,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiPromptsResponse200ItemDemonstrationsInlineColumnTypesItem")


@_attrs_define
class GetApiPromptsResponse200ItemDemonstrationsInlineColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (GetApiPromptsResponse200ItemDemonstrationsInlineColumnTypesItemType):
        id (str | Unset):
    """

    name: str
    type_: GetApiPromptsResponse200ItemDemonstrationsInlineColumnTypesItemType
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

        type_ = GetApiPromptsResponse200ItemDemonstrationsInlineColumnTypesItemType(d.pop("type"))

        id = d.pop("id", UNSET)

        get_api_prompts_response_200_item_demonstrations_inline_column_types_item = cls(
            name=name,
            type_=type_,
            id=id,
        )

        get_api_prompts_response_200_item_demonstrations_inline_column_types_item.additional_properties = d
        return get_api_prompts_response_200_item_demonstrations_inline_column_types_item

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
