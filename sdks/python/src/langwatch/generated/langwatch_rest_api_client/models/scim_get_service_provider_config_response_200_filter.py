from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimGetServiceProviderConfigResponse200Filter")


@_attrs_define
class ScimGetServiceProviderConfigResponse200Filter:
    """
    Attributes:
        supported (bool):
        max_results (int):
    """

    supported: bool
    max_results: int

    def to_dict(self) -> dict[str, Any]:
        supported = self.supported

        max_results = self.max_results

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "supported": supported,
                "maxResults": max_results,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        supported = d.pop("supported")

        max_results = d.pop("maxResults")

        scim_get_service_provider_config_response_200_filter = cls(
            supported=supported,
            max_results=max_results,
        )

        return scim_get_service_provider_config_response_200_filter
