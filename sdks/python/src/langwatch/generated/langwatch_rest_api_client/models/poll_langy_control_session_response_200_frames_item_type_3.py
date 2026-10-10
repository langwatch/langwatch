from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType3")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType3:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['cancel']):
        call_id (str):
    """

    protocol: Literal[1]
    type_: Literal["cancel"]
    call_id: str

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        call_id = self.call_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "callId": call_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["cancel"], d.pop("type"))
        if type_ != "cancel":
            raise ValueError(f"type must match const 'cancel', got '{type_}'")

        call_id = d.pop("callId")

        poll_langy_control_session_response_200_frames_item_type_3 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
        )

        return poll_langy_control_session_response_200_frames_item_type_3
