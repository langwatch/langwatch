from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_columns_item import (
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200ColumnsItem,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item import (
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItem,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_rows_item import (
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200RowsItem,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_statistics import (
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200Statistics,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200:
    """
    Attributes:
        columns (list[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200ColumnsItem]):
        rows (list[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200RowsItem]):
        statistics (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200Statistics):
        truncated (bool):
        follows_time_window (bool):
        follows_granularity (bool):
        diagnostics (list[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItem]):
        granularity_seconds (float | Unset):
        coarsened_from_seconds (float | Unset):
    """

    columns: list[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200ColumnsItem]
    rows: list[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200RowsItem]
    statistics: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200Statistics
    truncated: bool
    follows_time_window: bool
    follows_granularity: bool
    diagnostics: list[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItem]
    granularity_seconds: float | Unset = UNSET
    coarsened_from_seconds: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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

        truncated = self.truncated

        follows_time_window = self.follows_time_window

        follows_granularity = self.follows_granularity

        diagnostics = []
        for diagnostics_item_data in self.diagnostics:
            diagnostics_item = diagnostics_item_data.to_dict()
            diagnostics.append(diagnostics_item)

        granularity_seconds = self.granularity_seconds

        coarsened_from_seconds = self.coarsened_from_seconds

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "columns": columns,
                "rows": rows,
                "statistics": statistics,
                "truncated": truncated,
                "followsTimeWindow": follows_time_window,
                "followsGranularity": follows_granularity,
                "diagnostics": diagnostics,
            }
        )
        if granularity_seconds is not UNSET:
            field_dict["granularitySeconds"] = granularity_seconds
        if coarsened_from_seconds is not UNSET:
            field_dict["coarsenedFromSeconds"] = coarsened_from_seconds

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_columns_item import (
            PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200ColumnsItem,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item import (
            PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItem,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_rows_item import (
            PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200RowsItem,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_statistics import (
            PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200Statistics,
        )

        d = dict(src_dict)
        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200ColumnsItem.from_dict(
                columns_item_data
            )

            columns.append(columns_item)

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200RowsItem.from_dict(
                rows_item_data
            )

            rows.append(rows_item)

        statistics = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200Statistics.from_dict(
            d.pop("statistics")
        )

        truncated = d.pop("truncated")

        follows_time_window = d.pop("followsTimeWindow")

        follows_granularity = d.pop("followsGranularity")

        diagnostics = []
        _diagnostics = d.pop("diagnostics")
        for diagnostics_item_data in _diagnostics:
            diagnostics_item = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItem.from_dict(
                diagnostics_item_data
            )

            diagnostics.append(diagnostics_item)

        granularity_seconds = d.pop("granularitySeconds", UNSET)

        coarsened_from_seconds = d.pop("coarsenedFromSeconds", UNSET)

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200 = cls(
            columns=columns,
            rows=rows,
            statistics=statistics,
            truncated=truncated,
            follows_time_window=follows_time_window,
            follows_granularity=follows_granularity,
            diagnostics=diagnostics,
            granularity_seconds=granularity_seconds,
            coarsened_from_seconds=coarsened_from_seconds,
        )

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200

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
