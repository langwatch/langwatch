from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        candidate_trace_ids = self.candidate_trace_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_api_traces_by_trace_id_transcript_response_409.additional_properties = d
        return get_api_traces_by_trace_id_transcript_response_409

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
