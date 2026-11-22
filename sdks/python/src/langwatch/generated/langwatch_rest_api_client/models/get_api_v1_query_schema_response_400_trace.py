from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiV1QuerySchemaResponse400Trace")


@_attrs_define
class GetApiV1QuerySchemaResponse400Trace:
    """
    Attributes:
        trace_id (str | Unset):
        span_id (str | Unset):
        trace_url (str | Unset):
        logs_url (str | Unset):
    """

    trace_id: str | Unset = UNSET
    span_id: str | Unset = UNSET
    trace_url: str | Unset = UNSET
    logs_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        trace_id = self.trace_id

        span_id = self.span_id

        trace_url = self.trace_url

        logs_url = self.logs_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if trace_id is not UNSET:
            field_dict["traceId"] = trace_id
        if span_id is not UNSET:
            field_dict["spanId"] = span_id
        if trace_url is not UNSET:
            field_dict["traceUrl"] = trace_url
        if logs_url is not UNSET:
            field_dict["logsUrl"] = logs_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        trace_id = d.pop("traceId", UNSET)

        span_id = d.pop("spanId", UNSET)

        trace_url = d.pop("traceUrl", UNSET)

        logs_url = d.pop("logsUrl", UNSET)

        get_api_v1_query_schema_response_400_trace = cls(
            trace_id=trace_id,
            span_id=span_id,
            trace_url=trace_url,
            logs_url=logs_url,
        )

        get_api_v1_query_schema_response_400_trace.additional_properties = d
        return get_api_v1_query_schema_response_400_trace

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
