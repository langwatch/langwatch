from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_connected_agent_frames_body_frames_item_type_2_protocol import (
    PostConnectedAgentFramesBodyFramesItemType2Protocol,
)
from ..models.post_connected_agent_frames_body_frames_item_type_2_type import (
    PostConnectedAgentFramesBodyFramesItemType2Type,
)

T = TypeVar("T", bound="PostConnectedAgentFramesBodyFramesItemType2")


@_attrs_define
class PostConnectedAgentFramesBodyFramesItemType2:
    """
    Attributes:
        protocol (PostConnectedAgentFramesBodyFramesItemType2Protocol):
        type_ (PostConnectedAgentFramesBodyFramesItemType2Type):
    """

    protocol: PostConnectedAgentFramesBodyFramesItemType2Protocol
    type_: PostConnectedAgentFramesBodyFramesItemType2Type

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol.value

        type_ = self.type_.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        protocol = PostConnectedAgentFramesBodyFramesItemType2Protocol(d.pop("protocol"))

        type_ = PostConnectedAgentFramesBodyFramesItemType2Type(d.pop("type"))

        post_connected_agent_frames_body_frames_item_type_2 = cls(
            protocol=protocol,
            type_=type_,
        )

        return post_connected_agent_frames_body_frames_item_type_2
