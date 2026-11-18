from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTracesByTraceIdTranscriptResponse409")


@_attrs_define
class GetApiTracesByTraceIdTranscriptResponse409:
    """
    Attributes:
        message (str):
        candidate_trace_ids (list[str]):
    """

    message: str
    candidate_trace_ids: list[str]

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        candidate_trace_ids = self.candidate_trace_ids

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
                "candidateTraceIds": candidate_trace_ids,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        candidate_trace_ids = cast(list[str], d.pop("candidateTraceIds"))

        get_api_traces_by_trace_id_transcript_response_409 = cls(
            message=message,
            candidate_trace_ids=candidate_trace_ids,
        )

        return get_api_traces_by_trace_id_transcript_response_409
