from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType3Params")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType3Params:
    """
    Attributes:
        command (str):
        timeout (int | Unset):
        background (bool | Unset):
    """

    command: str
    timeout: int | Unset = UNSET
    background: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        command = self.command

        timeout = self.timeout

        background = self.background

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "command": command,
            }
        )
        if timeout is not UNSET:
            field_dict["timeout"] = timeout
        if background is not UNSET:
            field_dict["background"] = background

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        command = d.pop("command")

        timeout = d.pop("timeout", UNSET)

        background = d.pop("background", UNSET)

        poll_langy_control_session_response_200_frames_item_type_2_call_type_3_params = cls(
            command=command,
            timeout=timeout,
            background=background,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_3_params
