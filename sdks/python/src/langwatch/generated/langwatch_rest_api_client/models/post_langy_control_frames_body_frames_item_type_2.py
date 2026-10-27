from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_langy_control_frames_body_frames_item_type_2_error import (
        PostLangyControlFramesBodyFramesItemType2Error,
    )
    from ..models.post_langy_control_frames_body_frames_item_type_2_output import (
        PostLangyControlFramesBodyFramesItemType2Output,
    )


T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType2")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType2:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['result']):
        call_id (str):
        ok (bool):
        text (str | Unset):
        output (PostLangyControlFramesBodyFramesItemType2Output | Unset):
        error (PostLangyControlFramesBodyFramesItemType2Error | Unset):
    """

    protocol: Literal[1]
    type_: Literal["result"]
    call_id: str
    ok: bool
    text: str | Unset = UNSET
    output: PostLangyControlFramesBodyFramesItemType2Output | Unset = UNSET
    error: PostLangyControlFramesBodyFramesItemType2Error | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        call_id = self.call_id

        ok = self.ok

        text = self.text

        output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "callId": call_id,
                "ok": ok,
            }
        )
        if text is not UNSET:
            field_dict["text"] = text
        if output is not UNSET:
            field_dict["output"] = output
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_langy_control_frames_body_frames_item_type_2_error import (
            PostLangyControlFramesBodyFramesItemType2Error,
        )
        from ..models.post_langy_control_frames_body_frames_item_type_2_output import (
            PostLangyControlFramesBodyFramesItemType2Output,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["result"], d.pop("type"))
        if type_ != "result":
            raise ValueError(f"type must match const 'result', got '{type_}'")

        call_id = d.pop("callId")

        ok = d.pop("ok")

        text = d.pop("text", UNSET)

        _output = d.pop("output", UNSET)
        output: PostLangyControlFramesBodyFramesItemType2Output | Unset
        if isinstance(_output, Unset):
            output = UNSET
        else:
            output = PostLangyControlFramesBodyFramesItemType2Output.from_dict(_output)

        _error = d.pop("error", UNSET)
        error: PostLangyControlFramesBodyFramesItemType2Error | Unset
        if isinstance(_error, Unset):
            error = UNSET
        else:
            error = PostLangyControlFramesBodyFramesItemType2Error.from_dict(_error)

        post_langy_control_frames_body_frames_item_type_2 = cls(
            protocol=protocol,
            type_=type_,
            call_id=call_id,
            ok=ok,
            text=text,
            output=output,
            error=error,
        )

        post_langy_control_frames_body_frames_item_type_2.additional_properties = d
        return post_langy_control_frames_body_frames_item_type_2

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
