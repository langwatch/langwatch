from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_6_params import (
        PollLangyControlSessionResponse200FramesItemType2CallType6Params,
    )


T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType6")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType6:
    """
    Attributes:
        call_id (str):
        conversation_id (str):
        turn_id (str):
        deadline_at (int):
        tool (Literal['local_ls']):
        params (PollLangyControlSessionResponse200FramesItemType2CallType6Params):
    """

    call_id: str
    conversation_id: str
    turn_id: str
    deadline_at: int
    tool: Literal["local_ls"]
    params: PollLangyControlSessionResponse200FramesItemType2CallType6Params

    def to_dict(self) -> dict[str, Any]:
        call_id = self.call_id

        conversation_id = self.conversation_id

        turn_id = self.turn_id

        deadline_at = self.deadline_at

        tool = self.tool

        params = self.params.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "callId": call_id,
                "conversationId": conversation_id,
                "turnId": turn_id,
                "deadlineAt": deadline_at,
                "tool": tool,
                "params": params,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_6_params import (
            PollLangyControlSessionResponse200FramesItemType2CallType6Params,
        )

        d = dict(src_dict)
        call_id = d.pop("callId")

        conversation_id = d.pop("conversationId")

        turn_id = d.pop("turnId")

        deadline_at = d.pop("deadlineAt")

        tool = cast(Literal["local_ls"], d.pop("tool"))
        if tool != "local_ls":
            raise ValueError(f"tool must match const 'local_ls', got '{tool}'")

        params = PollLangyControlSessionResponse200FramesItemType2CallType6Params.from_dict(d.pop("params"))

        poll_langy_control_session_response_200_frames_item_type_2_call_type_6 = cls(
            call_id=call_id,
            conversation_id=conversation_id,
            turn_id=turn_id,
            deadline_at=deadline_at,
            tool=tool,
            params=params,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_6
