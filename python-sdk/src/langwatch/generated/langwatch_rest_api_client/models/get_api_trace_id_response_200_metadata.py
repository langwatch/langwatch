from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200Metadata")


@_attrs_define
class GetApiTraceIdResponse200Metadata:
    """
    Attributes:
        sdk_version (Union[Unset, str]):  Example: 0.1.11.
        sdk_language (Union[Unset, str]):  Example: python.
    """

    sdk_version: Union[Unset, str] = UNSET
    sdk_language: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sdk_version = self.sdk_version

        sdk_language = self.sdk_language

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if sdk_version is not UNSET:
            field_dict["sdk_version"] = sdk_version
        if sdk_language is not UNSET:
            field_dict["sdk_language"] = sdk_language

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sdk_version = d.pop("sdk_version", UNSET)

        sdk_language = d.pop("sdk_language", UNSET)

        get_api_trace_id_response_200_metadata = cls(
            sdk_version=sdk_version,
            sdk_language=sdk_language,
        )

        get_api_trace_id_response_200_metadata.additional_properties = d
        return get_api_trace_id_response_200_metadata

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
