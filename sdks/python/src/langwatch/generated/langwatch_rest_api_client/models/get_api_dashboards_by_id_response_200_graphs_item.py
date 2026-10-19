from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.get_api_dashboards_by_id_response_200_graphs_item_filters_type_0 import (
        GetApiDashboardsByIdResponse200GraphsItemFiltersType0,
    )
    from ..models.get_api_dashboards_by_id_response_200_graphs_item_graph import (
        GetApiDashboardsByIdResponse200GraphsItemGraph,
    )


T = TypeVar("T", bound="GetApiDashboardsByIdResponse200GraphsItem")


@_attrs_define
class GetApiDashboardsByIdResponse200GraphsItem:
    """
    Attributes:
        grid_column (int):
        grid_row (int):
        col_span (int):
        row_span (int):
        id (str):
        project_id (str):
        name (str):
        graph (GetApiDashboardsByIdResponse200GraphsItemGraph):
        filters (GetApiDashboardsByIdResponse200GraphsItemFiltersType0 | None):
        dashboard_id (None | str):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    grid_column: int
    grid_row: int
    col_span: int
    row_span: int
    id: str
    project_id: str
    name: str
    graph: GetApiDashboardsByIdResponse200GraphsItemGraph
    filters: GetApiDashboardsByIdResponse200GraphsItemFiltersType0 | None
    dashboard_id: None | str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_dashboards_by_id_response_200_graphs_item_filters_type_0 import (
            GetApiDashboardsByIdResponse200GraphsItemFiltersType0,
        )

        grid_column = self.grid_column

        grid_row = self.grid_row

        col_span = self.col_span

        row_span = self.row_span

        id = self.id

        project_id = self.project_id

        name = self.name

        graph = self.graph.to_dict()

        filters: dict[str, Any] | None
        if isinstance(self.filters, GetApiDashboardsByIdResponse200GraphsItemFiltersType0):
            filters = self.filters.to_dict()
        else:
            filters = self.filters

        dashboard_id: None | str
        dashboard_id = self.dashboard_id

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "gridColumn": grid_column,
                "gridRow": grid_row,
                "colSpan": col_span,
                "rowSpan": row_span,
                "id": id,
                "projectId": project_id,
                "name": name,
                "graph": graph,
                "filters": filters,
                "dashboardId": dashboard_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dashboards_by_id_response_200_graphs_item_filters_type_0 import (
            GetApiDashboardsByIdResponse200GraphsItemFiltersType0,
        )
        from ..models.get_api_dashboards_by_id_response_200_graphs_item_graph import (
            GetApiDashboardsByIdResponse200GraphsItemGraph,
        )

        d = dict(src_dict)
        grid_column = d.pop("gridColumn")

        grid_row = d.pop("gridRow")

        col_span = d.pop("colSpan")

        row_span = d.pop("rowSpan")

        id = d.pop("id")

        project_id = d.pop("projectId")

        name = d.pop("name")

        graph = GetApiDashboardsByIdResponse200GraphsItemGraph.from_dict(d.pop("graph"))

        def _parse_filters(data: object) -> GetApiDashboardsByIdResponse200GraphsItemFiltersType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                filters_type_0 = GetApiDashboardsByIdResponse200GraphsItemFiltersType0.from_dict(data)

                return filters_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiDashboardsByIdResponse200GraphsItemFiltersType0 | None, data)

        filters = _parse_filters(d.pop("filters"))

        def _parse_dashboard_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        dashboard_id = _parse_dashboard_id(d.pop("dashboardId"))

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        get_api_dashboards_by_id_response_200_graphs_item = cls(
            grid_column=grid_column,
            grid_row=grid_row,
            col_span=col_span,
            row_span=row_span,
            id=id,
            project_id=project_id,
            name=name,
            graph=graph,
            filters=filters,
            dashboard_id=dashboard_id,
            created_at=created_at,
            updated_at=updated_at,
        )

        return get_api_dashboards_by_id_response_200_graphs_item
