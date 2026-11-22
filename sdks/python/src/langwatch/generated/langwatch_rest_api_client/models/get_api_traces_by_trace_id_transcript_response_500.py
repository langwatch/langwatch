from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTracesByTraceIdTranscriptResponse500")


@_attrs_define
class GetApiTracesByTraceIdTranscriptResponse500:
    """
    Attributes:
        error (str):
        message (str | Unset):
    """

    error: str
    message: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        message = d.pop("message", UNSET)

        get_api_traces_by_trace_id_transcript_response_500 = cls(
            error=error,
            message=message,
        )

        return get_api_traces_by_trace_id_transcript_response_500
