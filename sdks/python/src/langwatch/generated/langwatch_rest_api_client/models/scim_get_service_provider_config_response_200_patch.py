from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimGetServiceProviderConfigResponse200Patch")


@_attrs_define
class ScimGetServiceProviderConfigResponse200Patch:
    """
    Attributes:
        supported (bool):
    """

    supported: bool

    def to_dict(self) -> dict[str, Any]:
        supported = self.supported

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "supported": supported,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        supported = d.pop("supported")

        scim_get_service_provider_config_response_200_patch = cls(
            supported=supported,
        )

        return scim_get_service_provider_config_response_200_patch
