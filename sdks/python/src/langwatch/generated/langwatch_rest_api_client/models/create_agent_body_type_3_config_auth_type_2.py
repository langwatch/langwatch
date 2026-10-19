from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="CreateAgentBodyType3ConfigAuthType2")


@_attrs_define
class CreateAgentBodyType3ConfigAuthType2:
    """
    Attributes:
        type_ (Literal['api_key']):
        header (str):
        value (str):
    """

    type_: Literal["api_key"]
    header: str
    value: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        header = self.header

        value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "header": header,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["api_key"], d.pop("type"))
        if type_ != "api_key":
            raise ValueError(f"type must match const 'api_key', got '{type_}'")

        header = d.pop("header")

        value = d.pop("value")

        create_agent_body_type_3_config_auth_type_2 = cls(
            type_=type_,
            header=header,
            value=value,
        )

        create_agent_body_type_3_config_auth_type_2.additional_properties = d
        return create_agent_body_type_3_config_auth_type_2

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
