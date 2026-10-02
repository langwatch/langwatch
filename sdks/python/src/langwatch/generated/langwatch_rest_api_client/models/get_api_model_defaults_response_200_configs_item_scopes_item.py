from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        id = self.id

        name = self.name

        field_dict: dict[str, Any] = {}

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

        return get_api_model_defaults_response_200_configs_item_scopes_item
