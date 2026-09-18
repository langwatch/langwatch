from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_langy_control_frames_body_frames_item_type_3_protocol import (
    PostLangyControlFramesBodyFramesItemType3Protocol,
)
from ..models.post_langy_control_frames_body_frames_item_type_3_type import (
    PostLangyControlFramesBodyFramesItemType3Type,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_langy_control_frames_body_frames_item_type_3_segments_item import (
        PostLangyControlFramesBodyFramesItemType3SegmentsItem,
    )


T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType3")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType3:
    """
    Attributes:
        protocol (PostLangyControlFramesBodyFramesItemType3Protocol):
        type_ (PostLangyControlFramesBodyFramesItemType3Type):
        call_id (str):
        summary (str):
        pattern (str):
        reason (str):
        skip_offered (bool):
        segments (list[PostLangyControlFramesBodyFramesItemType3SegmentsItem] | Unset):
        timeout_seconds (int | Unset):
    """

    protocol: PostLangyControlFramesBodyFramesItemType3Protocol
    type_: PostLangyControlFramesBodyFramesItemType3Type
    call_id: str
    summary: str
    pattern: str
    reason: str
    skip_offered: bool
    segments: list[PostLangyControlFramesBodyFramesItemType3SegmentsItem] | Unset = UNSET
    timeout_seconds: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol.value

        type_ = self.type_.value

        call_id = self.call_id

        summary = self.summary

        pattern = self.pattern

        reason = self.reason

        skip_offered = self.skip_offered

        segments: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.segments, Unset):
            segments = []
            for segments_item_data in self.segments:
                segments_item = segments_item_data.to_dict()
                segments.append(segments_item)

        timeout_seconds = self.timeout_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "callId": call_id,
                "summary": summary,
                "pattern": pattern,
                "reason": reason,
                "skipOffered": skip_offered,
            }
        )
        if segments is not UNSET:
            field_dict["segments"] = segments
        if timeout_seconds is not UNSET:
            field_dict["timeoutSeconds"] = timeout_seconds

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_langy_control_frames_body_frames_item_type_3_segments_item import (
            PostLangyControlFramesBodyFramesItemType3SegmentsItem,
        )

        d = dict(src_dict)
        protocol = PostLangyControlFramesBodyFramesItemType3Protocol(d.pop("protocol"))

        type_ = PostLangyControlFramesBodyFramesItemType3Type(d.pop("type"))

        call_id = d.pop("callId")

        summary = d.pop("summary")

        pattern = d.pop("pattern")

        reason = d.pop("reason")

        skip_offered = d.pop("skipOffered")

        _segments = d.pop("segments", UNSET)
        segments: list[PostLangyControlFramesBodyFramesItemType3SegmentsItem] | Unset = UNSET
        if _segments is not UNSET:
            segments = []
            for segments_item_data in _segments:
                segments_item = PostLangyControlFramesBodyFramesItemType3SegmentsItem.from_dict(segments_item_data)

                segments.append(segments_item)

        timeout_seconds = d.pop("timeoutSeconds", UNSET)

        post_langy_control_frames_body_frames_item_type_3 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
            summary=summary,
            pattern=pattern,
            reason=reason,
            skip_offered=skip_offered,
            segments=segments,
            timeout_seconds=timeout_seconds,
        )

        return post_langy_control_frames_body_frames_item_type_3
