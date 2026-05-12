from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_graphs_response_200_item_filters_type_0 import GetApiGraphsResponse200ItemFiltersType0
    from ..models.get_api_graphs_response_200_item_graph import GetApiGraphsResponse200ItemGraph


T = TypeVar("T", bound="GetApiGraphsResponse200Item")


@_attrs_define
class GetApiGraphsResponse200Item:
    """
    Attributes:
        id (str):
        name (str):
        graph (GetApiGraphsResponse200ItemGraph):
        filters (GetApiGraphsResponse200ItemFiltersType0 | None):
        dashboard_id (None | str):
        grid_column (float):
        grid_row (float):
        col_span (float):
        row_span (float):
        created_at (str):
        updated_at (str):
    """

    id: str
    name: str
    graph: GetApiGraphsResponse200ItemGraph
    filters: GetApiGraphsResponse200ItemFiltersType0 | None
    dashboard_id: None | str
    grid_column: float
    grid_row: float
    col_span: float
    row_span: float
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_graphs_response_200_item_filters_type_0 import GetApiGraphsResponse200ItemFiltersType0

        id = self.id

        name = self.name

        graph = self.graph.to_dict()

        filters: dict[str, Any] | None
        if isinstance(self.filters, GetApiGraphsResponse200ItemFiltersType0):
            filters = self.filters.to_dict()
        else:
            filters = self.filters

        dashboard_id: None | str
        dashboard_id = self.dashboard_id

        grid_column = self.grid_column

        grid_row = self.grid_row

        col_span = self.col_span

        row_span = self.row_span

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "graph": graph,
                "filters": filters,
                "dashboardId": dashboard_id,
                "gridColumn": grid_column,
                "gridRow": grid_row,
                "colSpan": col_span,
                "rowSpan": row_span,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_graphs_response_200_item_filters_type_0 import GetApiGraphsResponse200ItemFiltersType0
        from ..models.get_api_graphs_response_200_item_graph import GetApiGraphsResponse200ItemGraph

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        graph = GetApiGraphsResponse200ItemGraph.from_dict(d.pop("graph"))

        def _parse_filters(data: object) -> GetApiGraphsResponse200ItemFiltersType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                filters_type_0 = GetApiGraphsResponse200ItemFiltersType0.from_dict(data)

                return filters_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGraphsResponse200ItemFiltersType0 | None, data)

        filters = _parse_filters(d.pop("filters"))

        def _parse_dashboard_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        dashboard_id = _parse_dashboard_id(d.pop("dashboardId"))

        grid_column = d.pop("gridColumn")

        grid_row = d.pop("gridRow")

        col_span = d.pop("colSpan")

        row_span = d.pop("rowSpan")

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        get_api_graphs_response_200_item = cls(
            id=id,
            name=name,
            graph=graph,
            filters=filters,
            dashboard_id=dashboard_id,
            grid_column=grid_column,
            grid_row=grid_row,
            col_span=col_span,
            row_span=row_span,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_api_graphs_response_200_item.additional_properties = d
        return get_api_graphs_response_200_item

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
