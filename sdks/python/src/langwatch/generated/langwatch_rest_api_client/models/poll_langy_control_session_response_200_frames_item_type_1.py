from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        code = self.code.value

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        poll_langy_control_session_response_200_frames_item_type_1.additional_properties = d
        return poll_langy_control_session_response_200_frames_item_type_1

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
