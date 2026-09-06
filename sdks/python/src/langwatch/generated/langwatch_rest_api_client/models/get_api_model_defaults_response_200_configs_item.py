from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_model_defaults_response_200_configs_item_config import (
        GetApiModelDefaultsResponse200ConfigsItemConfig,
    )
    from ..models.get_api_model_defaults_response_200_configs_item_scopes_item import (
        GetApiModelDefaultsResponse200ConfigsItemScopesItem,
    )


T = TypeVar("T", bound="GetApiModelDefaultsResponse200ConfigsItem")


@_attrs_define
class GetApiModelDefaultsResponse200ConfigsItem:
    """
    Attributes:
        id (str):
        config (GetApiModelDefaultsResponse200ConfigsItemConfig):
        scopes (list[GetApiModelDefaultsResponse200ConfigsItemScopesItem]):
        created_at (str):
        updated_at (str):
    """

    id: str
    config: GetApiModelDefaultsResponse200ConfigsItemConfig
    scopes: list[GetApiModelDefaultsResponse200ConfigsItemScopesItem]
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        config = self.config.to_dict()

        scopes = []
        for scopes_item_data in self.scopes:
            scopes_item = scopes_item_data.to_dict()
            scopes.append(scopes_item)

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "config": config,
                "scopes": scopes,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_model_defaults_response_200_configs_item_config import (
            GetApiModelDefaultsResponse200ConfigsItemConfig,
        )
        from ..models.get_api_model_defaults_response_200_configs_item_scopes_item import (
            GetApiModelDefaultsResponse200ConfigsItemScopesItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        config = GetApiModelDefaultsResponse200ConfigsItemConfig.from_dict(d.pop("config"))

        scopes = []
        _scopes = d.pop("scopes")
        for scopes_item_data in _scopes:
            scopes_item = GetApiModelDefaultsResponse200ConfigsItemScopesItem.from_dict(scopes_item_data)

            scopes.append(scopes_item)

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        get_api_model_defaults_response_200_configs_item = cls(
            id=id,
            config=config,
            scopes=scopes,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_api_model_defaults_response_200_configs_item.additional_properties = d
        return get_api_model_defaults_response_200_configs_item

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
