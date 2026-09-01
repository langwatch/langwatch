from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200Statistics")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200Statistics:
    """
    Attributes:
        elapsed_ms (float):
        rows_read (float):
        bytes_read (float):
        rows_returned (float):
    """

    elapsed_ms: float
    rows_read: float
    bytes_read: float
    rows_returned: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        elapsed_ms = self.elapsed_ms

        rows_read = self.rows_read

        bytes_read = self.bytes_read

        rows_returned = self.rows_returned

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "elapsedMs": elapsed_ms,
                "rowsRead": rows_read,
                "bytesRead": bytes_read,
                "rowsReturned": rows_returned,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        elapsed_ms = d.pop("elapsedMs")

        rows_read = d.pop("rowsRead")

        bytes_read = d.pop("bytesRead")

        rows_returned = d.pop("rowsReturned")

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_statistics = cls(
            elapsed_ms=elapsed_ms,
            rows_read=rows_read,
            bytes_read=bytes_read,
            rows_returned=rows_returned,
        )

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_statistics.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_statistics

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
