from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType5Params")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType5Params:
    """
    Attributes:
        pattern (str):
        path (str | Unset):
        limit (int | Unset):
    """

    pattern: str
    path: str | Unset = UNSET
    limit: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        pattern = self.pattern

        path = self.path

        limit = self.limit

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "pattern": pattern,
            }
        )
        if path is not UNSET:
            field_dict["path"] = path
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pattern = d.pop("pattern")

        path = d.pop("path", UNSET)

        limit = d.pop("limit", UNSET)

        poll_langy_control_session_response_200_frames_item_type_2_call_type_5_params = cls(
            pattern=pattern,
            path=path,
            limit=limit,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_5_params
