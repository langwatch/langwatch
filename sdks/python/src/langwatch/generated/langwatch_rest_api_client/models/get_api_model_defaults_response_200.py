from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_model_defaults_response_200_configs_item import GetApiModelDefaultsResponse200ConfigsItem
    from ..models.get_api_model_defaults_response_200_effective import GetApiModelDefaultsResponse200Effective
    from ..models.get_api_model_defaults_response_200_scope import GetApiModelDefaultsResponse200Scope


T = TypeVar("T", bound="GetApiModelDefaultsResponse200")


@_attrs_define
class GetApiModelDefaultsResponse200:
    """
    Attributes:
        scope (GetApiModelDefaultsResponse200Scope):
        effective (GetApiModelDefaultsResponse200Effective):
        configs (list[GetApiModelDefaultsResponse200ConfigsItem]):
    """

    scope: GetApiModelDefaultsResponse200Scope
    effective: GetApiModelDefaultsResponse200Effective
    configs: list[GetApiModelDefaultsResponse200ConfigsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scope = self.scope.to_dict()

        effective = self.effective.to_dict()

        configs = []
        for configs_item_data in self.configs:
            configs_item = configs_item_data.to_dict()
            configs.append(configs_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scope": scope,
                "effective": effective,
                "configs": configs,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_model_defaults_response_200_configs_item import GetApiModelDefaultsResponse200ConfigsItem
        from ..models.get_api_model_defaults_response_200_effective import GetApiModelDefaultsResponse200Effective
        from ..models.get_api_model_defaults_response_200_scope import GetApiModelDefaultsResponse200Scope

        d = dict(src_dict)
        scope = GetApiModelDefaultsResponse200Scope.from_dict(d.pop("scope"))

        effective = GetApiModelDefaultsResponse200Effective.from_dict(d.pop("effective"))

        configs = []
        _configs = d.pop("configs")
        for configs_item_data in _configs:
            configs_item = GetApiModelDefaultsResponse200ConfigsItem.from_dict(configs_item_data)

            configs.append(configs_item)

        get_api_model_defaults_response_200 = cls(
            scope=scope,
            effective=effective,
            configs=configs,
        )

        get_api_model_defaults_response_200.additional_properties = d
        return get_api_model_defaults_response_200

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
