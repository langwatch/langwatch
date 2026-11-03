from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_body_type_6_config_setup_language import CreateAgentBodyType6ConfigSetupLanguage

T = TypeVar("T", bound="CreateAgentBodyType6ConfigSetup")


@_attrs_define
class CreateAgentBodyType6ConfigSetup:
    """
    Attributes:
        language (CreateAgentBodyType6ConfigSetupLanguage):
        code (str):
    """

    language: CreateAgentBodyType6ConfigSetupLanguage
    code: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        language = self.language.value

        code = self.code

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "language": language,
                "code": code,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        language = CreateAgentBodyType6ConfigSetupLanguage(d.pop("language"))

        code = d.pop("code")

        create_agent_body_type_6_config_setup = cls(
            language=language,
            code=code,
        )

        create_agent_body_type_6_config_setup.additional_properties = d
        return create_agent_body_type_6_config_setup

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
