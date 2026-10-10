from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call import (
        PollLangyControlSessionResponse200FramesItemType2Call,
    )


T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['call']):
        call (PollLangyControlSessionResponse200FramesItemType2Call):
    """

    protocol: Literal[1]
    type_: Literal["call"]
    call: PollLangyControlSessionResponse200FramesItemType2Call
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        call = self.call.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "call": call,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call import (
            PollLangyControlSessionResponse200FramesItemType2Call,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["call"], d.pop("type"))
        if type_ != "call":
            raise ValueError(f"type must match const 'call', got '{type_}'")

        call = PollLangyControlSessionResponse200FramesItemType2Call.from_dict(d.pop("call"))

        poll_langy_control_session_response_200_frames_item_type_2 = cls(
            protocol=protocol,
            type_=type_,
            call=call,
        )

        poll_langy_control_session_response_200_frames_item_type_2.additional_properties = d
        return poll_langy_control_session_response_200_frames_item_type_2

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
