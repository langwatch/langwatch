from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType3SegmentsItem")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType3SegmentsItem:
    """
    Attributes:
        command (str):
        pattern (str):
        read_only (bool):
    """

    command: str
    pattern: str
    read_only: bool

    def to_dict(self) -> dict[str, Any]:
        command = self.command

        pattern = self.pattern

        read_only = self.read_only

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "command": command,
                "pattern": pattern,
                "readOnly": read_only,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        command = d.pop("command")

        pattern = d.pop("pattern")

        read_only = d.pop("readOnly")

        post_langy_control_frames_body_frames_item_type_3_segments_item = cls(
            command=command,
            pattern=pattern,
            read_only=read_only,
        )

        return post_langy_control_frames_body_frames_item_type_3_segments_item
