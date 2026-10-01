from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateAgentBodyType3ConfigDevTunnel")


@_attrs_define
class CreateAgentBodyType3ConfigDevTunnel:
    """
    Attributes:
        previous_url (str | Unset):
        connected_at (str | Unset):
    """

    previous_url: str | Unset = UNSET
    connected_at: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        previous_url = self.previous_url

        connected_at = self.connected_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if previous_url is not UNSET:
            field_dict["previousUrl"] = previous_url
        if connected_at is not UNSET:
            field_dict["connectedAt"] = connected_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        previous_url = d.pop("previousUrl", UNSET)

        connected_at = d.pop("connectedAt", UNSET)

        create_agent_body_type_3_config_dev_tunnel = cls(
            previous_url=previous_url,
            connected_at=connected_at,
        )

        create_agent_body_type_3_config_dev_tunnel.additional_properties = d
        return create_agent_body_type_3_config_dev_tunnel

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
