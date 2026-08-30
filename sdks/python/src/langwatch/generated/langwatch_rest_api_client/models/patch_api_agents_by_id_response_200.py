from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_agents_by_id_response_200_type import PatchApiAgentsByIdResponse200Type

if TYPE_CHECKING:
    from ..models.patch_api_agents_by_id_response_200_config_type_0 import PatchApiAgentsByIdResponse200ConfigType0


T = TypeVar("T", bound="PatchApiAgentsByIdResponse200")


@_attrs_define
class PatchApiAgentsByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        type_ (PatchApiAgentsByIdResponse200Type):
        config (None | PatchApiAgentsByIdResponse200ConfigType0):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    type_: PatchApiAgentsByIdResponse200Type
    config: None | PatchApiAgentsByIdResponse200ConfigType0
    created_at: str
    updated_at: str
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_agents_by_id_response_200_config_type_0 import PatchApiAgentsByIdResponse200ConfigType0

        id = self.id

        name = self.name

        type_ = self.type_.value

        config: dict[str, Any] | None
        if isinstance(self.config, PatchApiAgentsByIdResponse200ConfigType0):
            config = self.config.to_dict()
        else:
            config = self.config

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "type": type_,
                "config": config,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_agents_by_id_response_200_config_type_0 import PatchApiAgentsByIdResponse200ConfigType0

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        type_ = PatchApiAgentsByIdResponse200Type(d.pop("type"))

        def _parse_config(data: object) -> None | PatchApiAgentsByIdResponse200ConfigType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                config_type_0 = PatchApiAgentsByIdResponse200ConfigType0.from_dict(data)

                return config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PatchApiAgentsByIdResponse200ConfigType0, data)

        config = _parse_config(d.pop("config"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        patch_api_agents_by_id_response_200 = cls(
            id=id,
            name=name,
            type_=type_,
            config=config,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        patch_api_agents_by_id_response_200.additional_properties = d
        return patch_api_agents_by_id_response_200

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
