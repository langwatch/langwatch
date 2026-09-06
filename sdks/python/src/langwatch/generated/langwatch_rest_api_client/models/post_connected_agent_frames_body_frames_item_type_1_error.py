from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostConnectedAgentFramesBodyFramesItemType1Error")


@_attrs_define
class PostConnectedAgentFramesBodyFramesItemType1Error:
    """
    Attributes:
        code (str):
        message (str):
    """

    code: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        code = self.code

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
        code = d.pop("code")

        message = d.pop("message")

        post_connected_agent_frames_body_frames_item_type_1_error = cls(
            code=code,
            message=message,
        )

        return post_connected_agent_frames_body_frames_item_type_1_error
