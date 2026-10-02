from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LangyLocalCancelCallResponse200")


@_attrs_define
class LangyLocalCancelCallResponse200:
    """
    Attributes:
        call_id (str):
        cancelled (bool):
    """

    call_id: str
    cancelled: bool

    def to_dict(self) -> dict[str, Any]:
        call_id = self.call_id

        cancelled = self.cancelled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "callId": call_id,
                "cancelled": cancelled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        call_id = d.pop("callId")

        cancelled = d.pop("cancelled")

        langy_local_cancel_call_response_200 = cls(
            call_id=call_id,
            cancelled=cancelled,
        )

        return langy_local_cancel_call_response_200
