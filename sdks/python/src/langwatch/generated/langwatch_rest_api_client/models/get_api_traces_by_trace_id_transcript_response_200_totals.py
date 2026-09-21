from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiTracesByTraceIdTranscriptResponse200Totals")


@_attrs_define
class GetApiTracesByTraceIdTranscriptResponse200Totals:
    """
    Attributes:
        model_calls (float):
        tool_calls (float):
        tokens (float):
        cost_usd (float):
    """

    model_calls: float
    tool_calls: float
    tokens: float
    cost_usd: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        model_calls = self.model_calls

        tool_calls = self.tool_calls

        tokens = self.tokens

        cost_usd = self.cost_usd

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "modelCalls": model_calls,
                "toolCalls": tool_calls,
                "tokens": tokens,
                "costUsd": cost_usd,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model_calls = d.pop("modelCalls")

        tool_calls = d.pop("toolCalls")

        tokens = d.pop("tokens")

        cost_usd = d.pop("costUsd")

        get_api_traces_by_trace_id_transcript_response_200_totals = cls(
            model_calls=model_calls,
            tool_calls=tool_calls,
            tokens=tokens,
            cost_usd=cost_usd,
        )

        get_api_traces_by_trace_id_transcript_response_200_totals.additional_properties = d
        return get_api_traces_by_trace_id_transcript_response_200_totals

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
