from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_model_defaults_by_id_body_config import PutApiModelDefaultsByIdBodyConfig
    from ..models.put_api_model_defaults_by_id_body_scopes_item import PutApiModelDefaultsByIdBodyScopesItem


T = TypeVar("T", bound="PutApiModelDefaultsByIdBody")


@_attrs_define
class PutApiModelDefaultsByIdBody:
    """
    Attributes:
        config (PutApiModelDefaultsByIdBodyConfig | Unset):
        scopes (list[PutApiModelDefaultsByIdBodyScopesItem] | Unset):
    """

    config: PutApiModelDefaultsByIdBodyConfig | Unset = UNSET
    scopes: list[PutApiModelDefaultsByIdBodyScopesItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        scopes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.scopes, Unset):
            scopes = []
            for scopes_item_data in self.scopes:
                scopes_item = scopes_item_data.to_dict()
                scopes.append(scopes_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if config is not UNSET:
            field_dict["config"] = config
        if scopes is not UNSET:
            field_dict["scopes"] = scopes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_model_defaults_by_id_body_config import PutApiModelDefaultsByIdBodyConfig
        from ..models.put_api_model_defaults_by_id_body_scopes_item import PutApiModelDefaultsByIdBodyScopesItem

        d = dict(src_dict)
        _config = d.pop("config", UNSET)
        config: PutApiModelDefaultsByIdBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PutApiModelDefaultsByIdBodyConfig.from_dict(_config)

        _scopes = d.pop("scopes", UNSET)
        scopes: list[PutApiModelDefaultsByIdBodyScopesItem] | Unset = UNSET
        if _scopes is not UNSET:
            scopes = []
            for scopes_item_data in _scopes:
                scopes_item = PutApiModelDefaultsByIdBodyScopesItem.from_dict(scopes_item_data)

                scopes.append(scopes_item)

        put_api_model_defaults_by_id_body = cls(
            config=config,
            scopes=scopes,
        )

        put_api_model_defaults_by_id_body.additional_properties = d
        return put_api_model_defaults_by_id_body

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
