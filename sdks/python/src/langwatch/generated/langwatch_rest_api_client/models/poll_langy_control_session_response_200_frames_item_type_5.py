from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType5")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType5:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['policy']):
        skip_permissions (bool):
    """

    protocol: Literal[1]
    type_: Literal["policy"]
    skip_permissions: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        skip_permissions = self.skip_permissions

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "skipPermissions": skip_permissions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["policy"], d.pop("type"))
        if type_ != "policy":
            raise ValueError(f"type must match const 'policy', got '{type_}'")

        skip_permissions = d.pop("skipPermissions")

        poll_langy_control_session_response_200_frames_item_type_5 = cls(
            protocol=protocol,
            type_=type_,
            skip_permissions=skip_permissions,
        )

        poll_langy_control_session_response_200_frames_item_type_5.additional_properties = d
        return poll_langy_control_session_response_200_frames_item_type_5

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
