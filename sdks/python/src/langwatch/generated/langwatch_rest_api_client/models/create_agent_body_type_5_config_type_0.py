from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="CreateAgentBodyType5ConfigType0")


@_attrs_define
class CreateAgentBodyType5ConfigType0:
    """
    Attributes:
        transport (Literal['elevenlabs_convai']):
        agent_id (str):
    """

    transport: Literal["elevenlabs_convai"]
    agent_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        transport = self.transport

        agent_id = self.agent_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "transport": transport,
                "agentId": agent_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        transport = cast(Literal["elevenlabs_convai"], d.pop("transport"))
        if transport != "elevenlabs_convai":
            raise ValueError(f"transport must match const 'elevenlabs_convai', got '{transport}'")

        agent_id = d.pop("agentId")

        create_agent_body_type_5_config_type_0 = cls(
            transport=transport,
            agent_id=agent_id,
        )

        create_agent_body_type_5_config_type_0.additional_properties = d
        return create_agent_body_type_5_config_type_0

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
