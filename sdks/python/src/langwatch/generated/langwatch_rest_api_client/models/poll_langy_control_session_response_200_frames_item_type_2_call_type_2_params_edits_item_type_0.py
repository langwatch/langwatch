from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0:
    """
    Attributes:
        old_text (str):
        new_text (str):
    """

    old_text: str
    new_text: str

    def to_dict(self) -> dict[str, Any]:
        old_text = self.old_text

        new_text = self.new_text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "oldText": old_text,
                "newText": new_text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        old_text = d.pop("oldText")

        new_text = d.pop("newText")

        poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_0 = cls(
            old_text=old_text,
            new_text=new_text,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_0
