from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="CallConnectedAgentResponse200Instance")


@_attrs_define
class CallConnectedAgentResponse200Instance:
    """
    Attributes:
        hostname (str):
        label (None | str):
    """

    hostname: str
    label: None | str

    def to_dict(self) -> dict[str, Any]:
        hostname = self.hostname

        label: None | str
        label = self.label

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "hostname": hostname,
                "label": label,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        hostname = d.pop("hostname")

        def _parse_label(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        label = _parse_label(d.pop("label"))

        call_connected_agent_response_200_instance = cls(
            hostname=hostname,
            label=label,
        )

        return call_connected_agent_response_200_instance
