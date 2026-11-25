from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType7Params")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType7Params:
    """
    Attributes:
        path (str | Unset):
    """

    path: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if path is not UNSET:
            field_dict["path"] = path

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path", UNSET)

        poll_langy_control_session_response_200_frames_item_type_2_call_type_7_params = cls(
            path=path,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_7_params
