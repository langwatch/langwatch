from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1:
    """
    Attributes:
        append (str):
    """

    append: str

    def to_dict(self) -> dict[str, Any]:
        append = self.append

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "append": append,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        append = d.pop("append")

        poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_1 = cls(
            append=append,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_1
