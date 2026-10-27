from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        protocol (Literal[1]):
        type_ (Literal['permission_required']):
        call_id (str):
        summary (str):
        pattern (str):
        reason (str):
        skip_offered (bool):
        segments (list[PostLangyControlFramesBodyFramesItemType3SegmentsItem] | Unset):
        timeout_seconds (int | Unset):
    """

    protocol: Literal[1]
    type_: Literal["permission_required"]
    call_id: str
    summary: str
    pattern: str
    reason: str
    skip_offered: bool
    segments: list[PostLangyControlFramesBodyFramesItemType3SegmentsItem] | Unset = UNSET
    timeout_seconds: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

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
        field_dict.update(self.additional_properties)
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
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["permission_required"], d.pop("type"))
        if type_ != "permission_required":
            raise ValueError(f"type must match const 'permission_required', got '{type_}'")

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

        post_langy_control_frames_body_frames_item_type_3.additional_properties = d
        return post_langy_control_frames_body_frames_item_type_3

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
