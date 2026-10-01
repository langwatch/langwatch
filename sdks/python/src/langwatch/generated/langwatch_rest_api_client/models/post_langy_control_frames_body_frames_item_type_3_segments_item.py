from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        command = self.command

        pattern = self.pattern

        read_only = self.read_only

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_langy_control_frames_body_frames_item_type_3_segments_item.additional_properties = d
        return post_langy_control_frames_body_frames_item_type_3_segments_item

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
