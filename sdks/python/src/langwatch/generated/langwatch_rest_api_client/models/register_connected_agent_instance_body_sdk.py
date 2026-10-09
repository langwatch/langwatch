from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RegisterConnectedAgentInstanceBodySdk")


@_attrs_define
class RegisterConnectedAgentInstanceBodySdk:
    """
    Attributes:
        name (str):
        version (str):
        language (str):
    """

    name: str
    version: str
    language: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        version = self.version

        language = self.language

        field_dict: dict[str, Any] = {}

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

        register_connected_agent_instance_body_sdk = cls(
            name=name,
            version=version,
            language=language,
        )

        return register_connected_agent_instance_body_sdk
