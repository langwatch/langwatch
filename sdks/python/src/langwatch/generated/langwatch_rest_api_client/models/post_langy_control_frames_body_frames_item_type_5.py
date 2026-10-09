from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_langy_control_frames_body_frames_item_type_5_protocol import (
    PostLangyControlFramesBodyFramesItemType5Protocol,
)
from ..models.post_langy_control_frames_body_frames_item_type_5_type import (
    PostLangyControlFramesBodyFramesItemType5Type,
)

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType5")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType5:
    """
    Attributes:
        protocol (PostLangyControlFramesBodyFramesItemType5Protocol):
        type_ (PostLangyControlFramesBodyFramesItemType5Type):
    """

    protocol: PostLangyControlFramesBodyFramesItemType5Protocol
    type_: PostLangyControlFramesBodyFramesItemType5Type

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
        protocol = PostLangyControlFramesBodyFramesItemType5Protocol(d.pop("protocol"))

        type_ = PostLangyControlFramesBodyFramesItemType5Type(d.pop("type"))

        post_langy_control_frames_body_frames_item_type_5 = cls(
            protocol=protocol,
            type_=type_,
        )

        return post_langy_control_frames_body_frames_item_type_5
