from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.langy_local_read_call_response_200_error_code import LangyLocalReadCallResponse200ErrorCode

T = TypeVar("T", bound="LangyLocalReadCallResponse200Error")


@_attrs_define
class LangyLocalReadCallResponse200Error:
    """
    Attributes:
        code (LangyLocalReadCallResponse200ErrorCode):
        message (str):
    """

    code: LangyLocalReadCallResponse200ErrorCode
    message: str

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code = LangyLocalReadCallResponse200ErrorCode(d.pop("code"))

        message = d.pop("message")

        langy_local_read_call_response_200_error = cls(
            code=code,
            message=message,
        )

        return langy_local_read_call_response_200_error
