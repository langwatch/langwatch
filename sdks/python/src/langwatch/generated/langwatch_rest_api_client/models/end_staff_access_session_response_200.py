from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EndStaffAccessSessionResponse200")


@_attrs_define
class EndStaffAccessSessionResponse200:
    """
    Attributes:
        ended (bool):
    """

    ended: bool

    def to_dict(self) -> dict[str, Any]:
        ended = self.ended

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ended": ended,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ended = d.pop("ended")

        end_staff_access_session_response_200 = cls(
            ended=ended,
        )

        return end_staff_access_session_response_200
