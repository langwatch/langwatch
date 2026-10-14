from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType4Params")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType4Params:
    """
    Attributes:
        pattern (str):
        path (str | Unset):
        glob (str | Unset):
        ignore_case (bool | Unset):
        literal (bool | Unset):
        context (int | Unset):
        limit (int | Unset):
    """

    pattern: str
    path: str | Unset = UNSET
    glob: str | Unset = UNSET
    ignore_case: bool | Unset = UNSET
    literal: bool | Unset = UNSET
    context: int | Unset = UNSET
    limit: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        pattern = self.pattern

        path = self.path

        glob = self.glob

        ignore_case = self.ignore_case

        literal = self.literal

        context = self.context

        limit = self.limit

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "pattern": pattern,
            }
        )
        if path is not UNSET:
            field_dict["path"] = path
        if glob is not UNSET:
            field_dict["glob"] = glob
        if ignore_case is not UNSET:
            field_dict["ignoreCase"] = ignore_case
        if literal is not UNSET:
            field_dict["literal"] = literal
        if context is not UNSET:
            field_dict["context"] = context
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pattern = d.pop("pattern")

        path = d.pop("path", UNSET)

        glob = d.pop("glob", UNSET)

        ignore_case = d.pop("ignoreCase", UNSET)

        literal = d.pop("literal", UNSET)

        context = d.pop("context", UNSET)

        limit = d.pop("limit", UNSET)

        poll_langy_control_session_response_200_frames_item_type_2_call_type_4_params = cls(
            pattern=pattern,
            path=path,
            glob=glob,
            ignore_case=ignore_case,
            literal=literal,
            context=context,
            limit=limit,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_4_params
