from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGatewayV1VirtualKeysBodyConfigRealtime")


@_attrs_define
class PostApiGatewayV1VirtualKeysBodyConfigRealtime:
    """
    Attributes:
        max_open_sessions (int | None | Unset):
    """

    max_open_sessions: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        max_open_sessions: int | None | Unset
        if isinstance(self.max_open_sessions, Unset):
            max_open_sessions = UNSET
        else:
            max_open_sessions = self.max_open_sessions

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if max_open_sessions is not UNSET:
            field_dict["maxOpenSessions"] = max_open_sessions

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_max_open_sessions(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        max_open_sessions = _parse_max_open_sessions(d.pop("maxOpenSessions", UNSET))

        post_api_gateway_v1_virtual_keys_body_config_realtime = cls(
            max_open_sessions=max_open_sessions,
        )

        post_api_gateway_v1_virtual_keys_body_config_realtime.additional_properties = d
        return post_api_gateway_v1_virtual_keys_body_config_realtime

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
