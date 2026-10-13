from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType0Params")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType0Params:
    """
    Attributes:
        path (str):
        offset (int | Unset):
        limit (int | Unset):
    """

    path: str
    offset: int | Unset = UNSET
    limit: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        offset = self.offset

        limit = self.limit

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
            }
        )
        if offset is not UNSET:
            field_dict["offset"] = offset
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        offset = d.pop("offset", UNSET)

        limit = d.pop("limit", UNSET)

        poll_langy_control_session_response_200_frames_item_type_2_call_type_0_params = cls(
            path=path,
            offset=offset,
            limit=limit,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_0_params
