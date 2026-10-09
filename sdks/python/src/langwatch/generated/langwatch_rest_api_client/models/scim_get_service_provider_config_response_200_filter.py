from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimGetServiceProviderConfigResponse200Filter")


@_attrs_define
class ScimGetServiceProviderConfigResponse200Filter:
    """
    Attributes:
        supported (bool | Unset):
        max_results (int | Unset):
    """

    supported: bool | Unset = UNSET
    max_results: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        supported = self.supported

        max_results = self.max_results

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if supported is not UNSET:
            field_dict["supported"] = supported
        if max_results is not UNSET:
            field_dict["maxResults"] = max_results

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        supported = d.pop("supported", UNSET)

        max_results = d.pop("maxResults", UNSET)

        scim_get_service_provider_config_response_200_filter = cls(
            supported=supported,
            max_results=max_results,
        )

        scim_get_service_provider_config_response_200_filter.additional_properties = d
        return scim_get_service_provider_config_response_200_filter

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
