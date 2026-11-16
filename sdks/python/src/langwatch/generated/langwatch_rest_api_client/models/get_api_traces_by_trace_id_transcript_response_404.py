from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTracesByTraceIdTranscriptResponse404")


@_attrs_define
class GetApiTracesByTraceIdTranscriptResponse404:
    """
    Attributes:
        message (str):
    """

    message: str

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        get_api_traces_by_trace_id_transcript_response_404 = cls(
            message=message,
        )

        return get_api_traces_by_trace_id_transcript_response_404
