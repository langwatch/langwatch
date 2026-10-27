from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimGetServiceProviderConfigResponse200Bulk")


@_attrs_define
class ScimGetServiceProviderConfigResponse200Bulk:
    """
    Attributes:
        supported (bool):
        max_operations (int):
        max_payload_size (int):
    """

    supported: bool
    max_operations: int
    max_payload_size: int

    def to_dict(self) -> dict[str, Any]:
        supported = self.supported

        max_operations = self.max_operations

        max_payload_size = self.max_payload_size

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "supported": supported,
                "maxOperations": max_operations,
                "maxPayloadSize": max_payload_size,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        supported = d.pop("supported")

        max_operations = d.pop("maxOperations")

        max_payload_size = d.pop("maxPayloadSize")

        scim_get_service_provider_config_response_200_bulk = cls(
            supported=supported,
            max_operations=max_operations,
            max_payload_size=max_payload_size,
        )

        return scim_get_service_provider_config_response_200_bulk
