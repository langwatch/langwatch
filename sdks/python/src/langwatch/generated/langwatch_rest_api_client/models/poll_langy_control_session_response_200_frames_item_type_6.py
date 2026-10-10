from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType6")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType6:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['disconnect']):
        reason (str):
    """

    protocol: Literal[1]
    type_: Literal["disconnect"]
    reason: str

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["disconnect"], d.pop("type"))
        if type_ != "disconnect":
            raise ValueError(f"type must match const 'disconnect', got '{type_}'")

        reason = d.pop("reason")

        poll_langy_control_session_response_200_frames_item_type_6 = cls(
            protocol=protocol,
            type_=type_,
            reason=reason,
        )

        return poll_langy_control_session_response_200_frames_item_type_6
