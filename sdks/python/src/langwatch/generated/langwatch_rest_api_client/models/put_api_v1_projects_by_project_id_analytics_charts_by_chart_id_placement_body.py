from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody")


@_attrs_define
class PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody:
    """
    Attributes:
        dashboard_id (str):
        grid_column (int | Unset):
        grid_row (int | Unset):
        col_span (int | Unset):
        row_span (int | Unset):
    """

    dashboard_id: str
    grid_column: int | Unset = UNSET
    grid_row: int | Unset = UNSET
    col_span: int | Unset = UNSET
    row_span: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        dashboard_id = self.dashboard_id

        grid_column = self.grid_column

        grid_row = self.grid_row

        col_span = self.col_span

        row_span = self.row_span

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "dashboardId": dashboard_id,
            }
        )
        if grid_column is not UNSET:
            field_dict["gridColumn"] = grid_column
        if grid_row is not UNSET:
            field_dict["gridRow"] = grid_row
        if col_span is not UNSET:
            field_dict["colSpan"] = col_span
        if row_span is not UNSET:
            field_dict["rowSpan"] = row_span

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        dashboard_id = d.pop("dashboardId")

        grid_column = d.pop("gridColumn", UNSET)

        grid_row = d.pop("gridRow", UNSET)

        col_span = d.pop("colSpan", UNSET)

        row_span = d.pop("rowSpan", UNSET)

        put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_body = cls(
            dashboard_id=dashboard_id,
            grid_column=grid_column,
            grid_row=grid_row,
            col_span=col_span,
            row_span=row_span,
        )

        put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_body.additional_properties = d
        return put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_body

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
