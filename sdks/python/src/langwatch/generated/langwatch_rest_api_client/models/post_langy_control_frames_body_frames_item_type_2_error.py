from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_langy_control_frames_body_frames_item_type_2_error_code import (
    PostLangyControlFramesBodyFramesItemType2ErrorCode,
)

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType2Error")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType2Error:
    """
    Attributes:
        code (PostLangyControlFramesBodyFramesItemType2ErrorCode):
        message (str):
    """

    code: PostLangyControlFramesBodyFramesItemType2ErrorCode
    message: str

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code = PostLangyControlFramesBodyFramesItemType2ErrorCode(d.pop("code"))

        message = d.pop("message")

        post_langy_control_frames_body_frames_item_type_2_error = cls(
            code=code,
            message=message,
        )

        return post_langy_control_frames_body_frames_item_type_2_error
