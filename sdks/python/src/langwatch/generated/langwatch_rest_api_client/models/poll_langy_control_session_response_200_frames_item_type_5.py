from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        skip_permissions = self.skip_permissions

        field_dict: dict[str, Any] = {}

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

        return poll_langy_control_session_response_200_frames_item_type_5
