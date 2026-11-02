from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_body_type_3_config_connector_teardown_language import (
    CreateAgentBodyType3ConfigConnectorTeardownLanguage,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateAgentBodyType3ConfigConnectorTeardown")


@_attrs_define
class CreateAgentBodyType3ConfigConnectorTeardown:
    """
    Attributes:
        language (CreateAgentBodyType3ConfigConnectorTeardownLanguage):
        code (str):
        secret_names (list[str] | Unset):
        dataset_id (str | Unset):
    """

    language: CreateAgentBodyType3ConfigConnectorTeardownLanguage
    code: str
    secret_names: list[str] | Unset = UNSET
    dataset_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        language = self.language.value

        code = self.code

        secret_names: list[str] | Unset = UNSET
        if not isinstance(self.secret_names, Unset):
            secret_names = self.secret_names

        dataset_id = self.dataset_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "language": language,
                "code": code,
            }
        )
        if secret_names is not UNSET:
            field_dict["secretNames"] = secret_names
        if dataset_id is not UNSET:
            field_dict["datasetId"] = dataset_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        language = CreateAgentBodyType3ConfigConnectorTeardownLanguage(d.pop("language"))

        code = d.pop("code")

        secret_names = cast(list[str], d.pop("secretNames", UNSET))

        dataset_id = d.pop("datasetId", UNSET)

        create_agent_body_type_3_config_connector_teardown = cls(
            language=language,
            code=code,
            secret_names=secret_names,
            dataset_id=dataset_id,
        )

        create_agent_body_type_3_config_connector_teardown.additional_properties = d
        return create_agent_body_type_3_config_connector_teardown

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
