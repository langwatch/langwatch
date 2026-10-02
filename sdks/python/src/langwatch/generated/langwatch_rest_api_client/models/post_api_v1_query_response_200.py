from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_query_response_200_columns_item import PostApiV1QueryResponse200ColumnsItem
    from ..models.post_api_v1_query_response_200_diagnostics_item import PostApiV1QueryResponse200DiagnosticsItem
    from ..models.post_api_v1_query_response_200_rows_item import PostApiV1QueryResponse200RowsItem
    from ..models.post_api_v1_query_response_200_statistics import PostApiV1QueryResponse200Statistics


T = TypeVar("T", bound="PostApiV1QueryResponse200")


@_attrs_define
class PostApiV1QueryResponse200:
    """
    Attributes:
        columns (list[PostApiV1QueryResponse200ColumnsItem]):
        rows (list[PostApiV1QueryResponse200RowsItem]):
        statistics (PostApiV1QueryResponse200Statistics):
        diagnostics (list[PostApiV1QueryResponse200DiagnosticsItem]):
        follows_time_window (bool):
        follows_granularity (bool):
        granularity_seconds (float | Unset):
        coarsened_from_seconds (float | Unset):
    """

    columns: list[PostApiV1QueryResponse200ColumnsItem]
    rows: list[PostApiV1QueryResponse200RowsItem]
    statistics: PostApiV1QueryResponse200Statistics
    diagnostics: list[PostApiV1QueryResponse200DiagnosticsItem]
    follows_time_window: bool
    follows_granularity: bool
    granularity_seconds: float | Unset = UNSET
    coarsened_from_seconds: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        statistics = self.statistics.to_dict()

        diagnostics = []
        for diagnostics_item_data in self.diagnostics:
            diagnostics_item = diagnostics_item_data.to_dict()
            diagnostics.append(diagnostics_item)

        follows_time_window = self.follows_time_window

        follows_granularity = self.follows_granularity

        granularity_seconds = self.granularity_seconds

        coarsened_from_seconds = self.coarsened_from_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "columns": columns,
                "rows": rows,
                "statistics": statistics,
                "diagnostics": diagnostics,
                "followsTimeWindow": follows_time_window,
                "followsGranularity": follows_granularity,
            }
        )
        if granularity_seconds is not UNSET:
            field_dict["granularitySeconds"] = granularity_seconds
        if coarsened_from_seconds is not UNSET:
            field_dict["coarsenedFromSeconds"] = coarsened_from_seconds

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_query_response_200_columns_item import PostApiV1QueryResponse200ColumnsItem
        from ..models.post_api_v1_query_response_200_diagnostics_item import PostApiV1QueryResponse200DiagnosticsItem
        from ..models.post_api_v1_query_response_200_rows_item import PostApiV1QueryResponse200RowsItem
        from ..models.post_api_v1_query_response_200_statistics import PostApiV1QueryResponse200Statistics

        d = dict(src_dict)
        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = PostApiV1QueryResponse200ColumnsItem.from_dict(columns_item_data)

            columns.append(columns_item)

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = PostApiV1QueryResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        statistics = PostApiV1QueryResponse200Statistics.from_dict(d.pop("statistics"))

        diagnostics = []
        _diagnostics = d.pop("diagnostics")
        for diagnostics_item_data in _diagnostics:
            diagnostics_item = PostApiV1QueryResponse200DiagnosticsItem.from_dict(diagnostics_item_data)

            diagnostics.append(diagnostics_item)

        follows_time_window = d.pop("followsTimeWindow")

        follows_granularity = d.pop("followsGranularity")

        granularity_seconds = d.pop("granularitySeconds", UNSET)

        coarsened_from_seconds = d.pop("coarsenedFromSeconds", UNSET)

        post_api_v1_query_response_200 = cls(
            columns=columns,
            rows=rows,
            statistics=statistics,
            diagnostics=diagnostics,
            follows_time_window=follows_time_window,
            follows_granularity=follows_granularity,
            granularity_seconds=granularity_seconds,
            coarsened_from_seconds=coarsened_from_seconds,
        )

        return post_api_v1_query_response_200
