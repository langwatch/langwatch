from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..models.poll_langy_control_session_response_200_frames_item_type_4_decision import (
    PollLangyControlSessionResponse200FramesItemType4Decision,
)

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType4")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType4:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['permission']):
        call_id (str):
        decision (PollLangyControlSessionResponse200FramesItemType4Decision):
    """

    protocol: Literal[1]
    type_: Literal["permission"]
    call_id: str
    decision: PollLangyControlSessionResponse200FramesItemType4Decision

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        call_id = self.call_id

        decision = self.decision.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "callId": call_id,
                "decision": decision,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["permission"], d.pop("type"))
        if type_ != "permission":
            raise ValueError(f"type must match const 'permission', got '{type_}'")

        call_id = d.pop("callId")

        decision = PollLangyControlSessionResponse200FramesItemType4Decision(d.pop("decision"))

        poll_langy_control_session_response_200_frames_item_type_4 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
            decision=decision,
        )

        return poll_langy_control_session_response_200_frames_item_type_4
