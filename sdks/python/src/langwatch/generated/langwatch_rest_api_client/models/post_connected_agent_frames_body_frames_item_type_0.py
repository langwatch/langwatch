from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_connected_agent_frames_body_frames_item_type_0_protocol import (
    PostConnectedAgentFramesBodyFramesItemType0Protocol,
)
from ..models.post_connected_agent_frames_body_frames_item_type_0_type import (
    PostConnectedAgentFramesBodyFramesItemType0Type,
)

T = TypeVar("T", bound="PostConnectedAgentFramesBodyFramesItemType0")


@_attrs_define
class PostConnectedAgentFramesBodyFramesItemType0:
    """
    Attributes:
        protocol (PostConnectedAgentFramesBodyFramesItemType0Protocol):
        type_ (PostConnectedAgentFramesBodyFramesItemType0Type):
        call_id (str):
    """

    protocol: PostConnectedAgentFramesBodyFramesItemType0Protocol
    type_: PostConnectedAgentFramesBodyFramesItemType0Type
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
        protocol = PostConnectedAgentFramesBodyFramesItemType0Protocol(d.pop("protocol"))

        type_ = PostConnectedAgentFramesBodyFramesItemType0Type(d.pop("type"))

        call_id = d.pop("callId")

        post_connected_agent_frames_body_frames_item_type_0 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
        )

        return post_connected_agent_frames_body_frames_item_type_0
