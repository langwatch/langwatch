from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItemType0ErrorType0")


@_attrs_define
class GetApiTraceIdResponse200SpansItemType0ErrorType0:
    """
    Attributes:
        has_error (bool):
        message (str):
        stacktrace (list[str]):
    """

    has_error: bool
    message: str
    stacktrace: list[str]

    def to_dict(self) -> dict[str, Any]:
        has_error = self.has_error

        message = self.message

        stacktrace = self.stacktrace

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "has_error": has_error,
                "message": message,
                "stacktrace": stacktrace,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        has_error = d.pop("has_error")

        message = d.pop("message")

        stacktrace = cast(list[str], d.pop("stacktrace"))

        get_api_trace_id_response_200_spans_item_type_0_error_type_0 = cls(
            has_error=has_error,
            message=message,
            stacktrace=stacktrace,
        )

        return get_api_trace_id_response_200_spans_item_type_0_error_type_0
