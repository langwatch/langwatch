from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LangyLocalStartCallResponse200")


@_attrs_define
class LangyLocalStartCallResponse200:
    """
    Attributes:
        call_id (str):
    """

    call_id: str

    def to_dict(self) -> dict[str, Any]:
        call_id = self.call_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "callId": call_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        call_id = d.pop("callId")

        langy_local_start_call_response_200 = cls(
            call_id=call_id,
        )

        return langy_local_start_call_response_200
