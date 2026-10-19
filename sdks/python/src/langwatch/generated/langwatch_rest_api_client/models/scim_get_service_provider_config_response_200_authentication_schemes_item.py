from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem")


@_attrs_define
class ScimGetServiceProviderConfigResponse200AuthenticationSchemesItem:
    """
    Attributes:
        type_ (str):
        name (str):
        description (str):
    """

    type_: str
    name: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        name = self.name

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "name": name,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        name = d.pop("name")

        description = d.pop("description")

        scim_get_service_provider_config_response_200_authentication_schemes_item = cls(
            type_=type_,
            name=name,
            description=description,
        )

        return scim_get_service_provider_config_response_200_authentication_schemes_item
