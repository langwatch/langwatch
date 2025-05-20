from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Metadata")


@_attrs_define
class Metadata:
    """
    Attributes:
        sdk_language (Union[Unset, str]):
        sdk_version (Union[Unset, str]):
    """

    sdk_language: Union[Unset, str] = UNSET
    sdk_version: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sdk_language = self.sdk_language

        sdk_version = self.sdk_version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if sdk_language is not UNSET:
            field_dict["sdk_language"] = sdk_language
        if sdk_version is not UNSET:
            field_dict["sdk_version"] = sdk_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sdk_language = d.pop("sdk_language", UNSET)

        sdk_version = d.pop("sdk_version", UNSET)

        metadata = cls(
            sdk_language=sdk_language,
            sdk_version=sdk_version,
        )

        metadata.additional_properties = d
        return metadata

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
