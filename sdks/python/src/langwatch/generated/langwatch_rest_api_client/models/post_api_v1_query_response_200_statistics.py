from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiV1QueryResponse200Statistics")


@_attrs_define
class PostApiV1QueryResponse200Statistics:
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

    def to_dict(self) -> dict[str, Any]:
        elapsed_ms = self.elapsed_ms

        rows_read = self.rows_read

        bytes_read = self.bytes_read

        rows_returned = self.rows_returned

        field_dict: dict[str, Any] = {}

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

        post_api_v1_query_response_200_statistics = cls(
            elapsed_ms=elapsed_ms,
            rows_read=rows_read,
            bytes_read=bytes_read,
            rows_returned=rows_returned,
        )

        return post_api_v1_query_response_200_statistics
