from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="CreateAgentBodyType0ConfigVersionMetadata")


@_attrs_define
class CreateAgentBodyType0ConfigVersionMetadata:
    """
    Attributes:
        version_id (str):
        version_number (float):
        version_created_at (str):
    """

    version_id: str
    version_number: float
    version_created_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version_id = self.version_id

        version_number = self.version_number

        version_created_at = self.version_created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "versionId": version_id,
                "versionNumber": version_number,
                "versionCreatedAt": version_created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version_id = d.pop("versionId")

        version_number = d.pop("versionNumber")

        version_created_at = d.pop("versionCreatedAt")

        create_agent_body_type_0_config_version_metadata = cls(
            version_id=version_id,
            version_number=version_number,
            version_created_at=version_created_at,
        )

        create_agent_body_type_0_config_version_metadata.additional_properties = d
        return create_agent_body_type_0_config_version_metadata

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
