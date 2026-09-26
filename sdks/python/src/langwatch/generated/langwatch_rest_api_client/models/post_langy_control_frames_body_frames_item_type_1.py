from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_langy_control_frames_body_frames_item_type_1_protocol import (
    PostLangyControlFramesBodyFramesItemType1Protocol,
)
from ..models.post_langy_control_frames_body_frames_item_type_1_type import (
    PostLangyControlFramesBodyFramesItemType1Type,
)

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType1")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType1:
    """
    Attributes:
        protocol (PostLangyControlFramesBodyFramesItemType1Protocol):
        type_ (PostLangyControlFramesBodyFramesItemType1Type):
        call_id (str):
    """

    protocol: PostLangyControlFramesBodyFramesItemType1Protocol
    type_: PostLangyControlFramesBodyFramesItemType1Type
    call_id: str

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol.value

        type_ = self.type_.value

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
        protocol = PostLangyControlFramesBodyFramesItemType1Protocol(d.pop("protocol"))

        type_ = PostLangyControlFramesBodyFramesItemType1Type(d.pop("type"))

        call_id = d.pop("callId")

        post_langy_control_frames_body_frames_item_type_1 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
        )

        return post_langy_control_frames_body_frames_item_type_1
