from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType1Params")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType1Params:
    """
    Attributes:
        path (str):
        content (str):
    """

    path: str
    content: str

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        content = self.content

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
                "content": content,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        content = d.pop("content")

        poll_langy_control_session_response_200_frames_item_type_2_call_type_1_params = cls(
            path=path,
            content=content,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_1_params
