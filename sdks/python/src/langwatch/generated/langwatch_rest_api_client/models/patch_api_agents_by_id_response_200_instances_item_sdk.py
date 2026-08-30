from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchApiAgentsByIdResponse200InstancesItemSdk")


@_attrs_define
class PatchApiAgentsByIdResponse200InstancesItemSdk:
    """
    Attributes:
        name (str):
        version (str):
        language (str):
    """

    name: str
    version: str
    language: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        version = self.version

        language = self.language

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "version": version,
                "language": language,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        version = d.pop("version")

        language = d.pop("language")

        patch_api_agents_by_id_response_200_instances_item_sdk = cls(
            name=name,
            version=version,
            language=language,
        )

        patch_api_agents_by_id_response_200_instances_item_sdk.additional_properties = d
        return patch_api_agents_by_id_response_200_instances_item_sdk

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
