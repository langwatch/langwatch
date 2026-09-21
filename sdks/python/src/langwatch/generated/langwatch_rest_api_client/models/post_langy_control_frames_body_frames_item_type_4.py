from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_langy_control_frames_body_frames_item_type_4_decision import (
    PostLangyControlFramesBodyFramesItemType4Decision,
)
from ..models.post_langy_control_frames_body_frames_item_type_4_protocol import (
    PostLangyControlFramesBodyFramesItemType4Protocol,
)
from ..models.post_langy_control_frames_body_frames_item_type_4_type import (
    PostLangyControlFramesBodyFramesItemType4Type,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType4")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType4:
    """
    Attributes:
        protocol (PostLangyControlFramesBodyFramesItemType4Protocol):
        type_ (PostLangyControlFramesBodyFramesItemType4Type):
        call_id (str):
        decision (PostLangyControlFramesBodyFramesItemType4Decision):
        patterns (list[str] | Unset):
    """

    protocol: PostLangyControlFramesBodyFramesItemType4Protocol
    type_: PostLangyControlFramesBodyFramesItemType4Type
    call_id: str
    decision: PostLangyControlFramesBodyFramesItemType4Decision
    patterns: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol.value

        type_ = self.type_.value

        call_id = self.call_id

        decision = self.decision.value

        patterns: list[str] | Unset = UNSET
        if not isinstance(self.patterns, Unset):
            patterns = self.patterns

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "callId": call_id,
                "decision": decision,
            }
        )
        if patterns is not UNSET:
            field_dict["patterns"] = patterns

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        protocol = PostLangyControlFramesBodyFramesItemType4Protocol(d.pop("protocol"))

        type_ = PostLangyControlFramesBodyFramesItemType4Type(d.pop("type"))

        call_id = d.pop("callId")

        decision = PostLangyControlFramesBodyFramesItemType4Decision(d.pop("decision"))

        patterns = cast(list[str], d.pop("patterns", UNSET))

        post_langy_control_frames_body_frames_item_type_4 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
            decision=decision,
            patterns=patterns,
        )

        return post_langy_control_frames_body_frames_item_type_4
