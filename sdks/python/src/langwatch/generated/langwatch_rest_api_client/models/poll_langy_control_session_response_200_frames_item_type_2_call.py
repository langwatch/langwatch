from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2Call")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2Call:
    """
    Attributes:
        call_id (str):
        conversation_id (str):
        turn_id (str):
        deadline_at (int):
    """

    call_id: str
    conversation_id: str
    turn_id: str
    deadline_at: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        call_id = self.call_id

        conversation_id = self.conversation_id

        turn_id = self.turn_id

        deadline_at = self.deadline_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "callId": call_id,
                "conversationId": conversation_id,
                "turnId": turn_id,
                "deadlineAt": deadline_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        call_id = d.pop("callId")

        conversation_id = d.pop("conversationId")

        turn_id = d.pop("turnId")

        deadline_at = d.pop("deadlineAt")

        poll_langy_control_session_response_200_frames_item_type_2_call = cls(
            call_id=call_id,
            conversation_id=conversation_id,
            turn_id=turn_id,
            deadline_at=deadline_at,
        )

        poll_langy_control_session_response_200_frames_item_type_2_call.additional_properties = d
        return poll_langy_control_session_response_200_frames_item_type_2_call

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
