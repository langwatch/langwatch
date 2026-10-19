from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.langy_local_read_call_response_200_state import LangyLocalReadCallResponse200State
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.langy_local_read_call_response_200_error import LangyLocalReadCallResponse200Error
    from ..models.langy_local_read_call_response_200_output import LangyLocalReadCallResponse200Output


T = TypeVar("T", bound="LangyLocalReadCallResponse200")


@_attrs_define
class LangyLocalReadCallResponse200:
    """
    Attributes:
        call_id (str):
        state (LangyLocalReadCallResponse200State):
        ok (bool | Unset):
        text (str | Unset):
        output (LangyLocalReadCallResponse200Output | Unset):
        error (LangyLocalReadCallResponse200Error | Unset):
    """

    call_id: str
    state: LangyLocalReadCallResponse200State
    ok: bool | Unset = UNSET
    text: str | Unset = UNSET
    output: LangyLocalReadCallResponse200Output | Unset = UNSET
    error: LangyLocalReadCallResponse200Error | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        call_id = self.call_id

        state = self.state.value

        ok = self.ok

        text = self.text

        output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "callId": call_id,
                "state": state,
            }
        )
        if ok is not UNSET:
            field_dict["ok"] = ok
        if text is not UNSET:
            field_dict["text"] = text
        if output is not UNSET:
            field_dict["output"] = output
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.langy_local_read_call_response_200_error import LangyLocalReadCallResponse200Error
        from ..models.langy_local_read_call_response_200_output import LangyLocalReadCallResponse200Output

        d = dict(src_dict)
        call_id = d.pop("callId")

        state = LangyLocalReadCallResponse200State(d.pop("state"))

        ok = d.pop("ok", UNSET)

        text = d.pop("text", UNSET)

        _output = d.pop("output", UNSET)
        output: LangyLocalReadCallResponse200Output | Unset
        if isinstance(_output, Unset):
            output = UNSET
        else:
            output = LangyLocalReadCallResponse200Output.from_dict(_output)

        _error = d.pop("error", UNSET)
        error: LangyLocalReadCallResponse200Error | Unset
        if isinstance(_error, Unset):
            error = UNSET
        else:
            error = LangyLocalReadCallResponse200Error.from_dict(_error)

        langy_local_read_call_response_200 = cls(
            call_id=call_id,
            state=state,
            ok=ok,
            text=text,
            output=output,
            error=error,
        )

        return langy_local_read_call_response_200
