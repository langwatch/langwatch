from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..models.poll_langy_control_session_response_200_frames_item_type_1_code import (
    PollLangyControlSessionResponse200FramesItemType1Code,
)

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType1")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType1:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['refused']):
        code (PollLangyControlSessionResponse200FramesItemType1Code):
        message (str):
    """

    protocol: Literal[1]
    type_: Literal["refused"]
    code: PollLangyControlSessionResponse200FramesItemType1Code
    message: str

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        code = self.code.value

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "code": code,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["refused"], d.pop("type"))
        if type_ != "refused":
            raise ValueError(f"type must match const 'refused', got '{type_}'")

        code = PollLangyControlSessionResponse200FramesItemType1Code(d.pop("code"))

        message = d.pop("message")

        poll_langy_control_session_response_200_frames_item_type_1 = cls(
            protocol=protocol,
            type_=type_,
            code=code,
            message=message,
        )

        return poll_langy_control_session_response_200_frames_item_type_1
