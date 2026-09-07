from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimGetServiceProviderConfigResponse200Bulk")


@_attrs_define
class ScimGetServiceProviderConfigResponse200Bulk:
    """
    Attributes:
        supported (bool | Unset):
        max_operations (int | Unset):
        max_payload_size (int | Unset):
    """

    supported: bool | Unset = UNSET
    max_operations: int | Unset = UNSET
    max_payload_size: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        supported = self.supported

        max_operations = self.max_operations

        max_payload_size = self.max_payload_size

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if supported is not UNSET:
            field_dict["supported"] = supported
        if max_operations is not UNSET:
            field_dict["maxOperations"] = max_operations
        if max_payload_size is not UNSET:
            field_dict["maxPayloadSize"] = max_payload_size

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        supported = d.pop("supported", UNSET)

        max_operations = d.pop("maxOperations", UNSET)

        max_payload_size = d.pop("maxPayloadSize", UNSET)

        scim_get_service_provider_config_response_200_bulk = cls(
            supported=supported,
            max_operations=max_operations,
            max_payload_size=max_payload_size,
        )

        scim_get_service_provider_config_response_200_bulk.additional_properties = d
        return scim_get_service_provider_config_response_200_bulk

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
