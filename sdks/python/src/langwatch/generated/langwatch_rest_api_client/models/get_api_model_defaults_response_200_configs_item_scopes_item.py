from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_model_defaults_response_200_configs_item_scopes_item_type import (
    GetApiModelDefaultsResponse200ConfigsItemScopesItemType,
)

T = TypeVar("T", bound="GetApiModelDefaultsResponse200ConfigsItemScopesItem")


@_attrs_define
class GetApiModelDefaultsResponse200ConfigsItemScopesItem:
    """
    Attributes:
        type_ (GetApiModelDefaultsResponse200ConfigsItemScopesItemType):
        id (str):
        name (str):
    """

    type_: GetApiModelDefaultsResponse200ConfigsItemScopesItemType
    id: str
    name: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        id = self.id

        name = self.name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "id": id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = GetApiModelDefaultsResponse200ConfigsItemScopesItemType(d.pop("type"))

        id = d.pop("id")

        name = d.pop("name")

        get_api_model_defaults_response_200_configs_item_scopes_item = cls(
            type_=type_,
            id=id,
            name=name,
        )

        get_api_model_defaults_response_200_configs_item_scopes_item.additional_properties = d
        return get_api_model_defaults_response_200_configs_item_scopes_item

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
