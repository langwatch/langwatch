from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PatchApiTracesByTraceIdMetadataResponse200")


@_attrs_define
class PatchApiTracesByTraceIdMetadataResponse200:
    """
    Attributes:
        trace_id (str):
    """

    trace_id: str

    def to_dict(self) -> dict[str, Any]:
        trace_id = self.trace_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "traceId": trace_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        trace_id = d.pop("traceId")

        patch_api_traces_by_trace_id_metadata_response_200 = cls(
            trace_id=trace_id,
        )

        return patch_api_traces_by_trace_id_metadata_response_200
