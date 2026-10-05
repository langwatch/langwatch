from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200LwqlLimits")


@_attrs_define
class GetApiV1QueryReferenceResponse200LwqlLimits:
    """
    Attributes:
        max_statement_length (float):
        max_rows_returned (float):
        max_result_bytes (float):
        max_execution_time_seconds (float):
        pagination (str):
    """

    max_statement_length: float
    max_rows_returned: float
    max_result_bytes: float
    max_execution_time_seconds: float
    pagination: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        max_statement_length = self.max_statement_length

        max_rows_returned = self.max_rows_returned

        max_result_bytes = self.max_result_bytes

        max_execution_time_seconds = self.max_execution_time_seconds

        pagination = self.pagination

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "maxStatementLength": max_statement_length,
                "maxRowsReturned": max_rows_returned,
                "maxResultBytes": max_result_bytes,
                "maxExecutionTimeSeconds": max_execution_time_seconds,
                "pagination": pagination,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        max_statement_length = d.pop("maxStatementLength")

        max_rows_returned = d.pop("maxRowsReturned")

        max_result_bytes = d.pop("maxResultBytes")

        max_execution_time_seconds = d.pop("maxExecutionTimeSeconds")

        pagination = d.pop("pagination")

        get_api_v1_query_reference_response_200_lwql_limits = cls(
            max_statement_length=max_statement_length,
            max_rows_returned=max_rows_returned,
            max_result_bytes=max_result_bytes,
            max_execution_time_seconds=max_execution_time_seconds,
            pagination=pagination,
        )

        get_api_v1_query_reference_response_200_lwql_limits.additional_properties = d
        return get_api_v1_query_reference_response_200_lwql_limits

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
