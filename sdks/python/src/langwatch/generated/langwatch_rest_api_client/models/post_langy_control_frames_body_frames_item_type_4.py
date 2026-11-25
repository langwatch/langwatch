from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_langy_control_frames_body_frames_item_type_4_decision import (
    PostLangyControlFramesBodyFramesItemType4Decision,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType4")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType4:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['permission_answered']):
        call_id (str):
        decision (PostLangyControlFramesBodyFramesItemType4Decision):
        patterns (list[str] | Unset):
    """

    protocol: Literal[1]
    type_: Literal["permission_answered"]
    call_id: str
    decision: PostLangyControlFramesBodyFramesItemType4Decision
    patterns: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        call_id = self.call_id

        decision = self.decision.value

        patterns: list[str] | Unset = UNSET
        if not isinstance(self.patterns, Unset):
            patterns = self.patterns

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["permission_answered"], d.pop("type"))
        if type_ != "permission_answered":
            raise ValueError(f"type must match const 'permission_answered', got '{type_}'")

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

        post_langy_control_frames_body_frames_item_type_4.additional_properties = d
        return post_langy_control_frames_body_frames_item_type_4

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
