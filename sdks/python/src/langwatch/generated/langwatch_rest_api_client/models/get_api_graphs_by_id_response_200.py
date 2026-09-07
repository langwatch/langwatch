from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_graphs_by_id_response_200_filters_type_0 import GetApiGraphsByIdResponse200FiltersType0
    from ..models.get_api_graphs_by_id_response_200_graph import GetApiGraphsByIdResponse200Graph


T = TypeVar("T", bound="GetApiGraphsByIdResponse200")


@_attrs_define
class GetApiGraphsByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        graph (GetApiGraphsByIdResponse200Graph):
        filters (GetApiGraphsByIdResponse200FiltersType0 | None):
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
    graph: GetApiGraphsByIdResponse200Graph
    filters: GetApiGraphsByIdResponse200FiltersType0 | None
    dashboard_id: None | str
    grid_column: float
    grid_row: float
    col_span: float
    row_span: float
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_graphs_by_id_response_200_filters_type_0 import GetApiGraphsByIdResponse200FiltersType0

        id = self.id

        name = self.name

        graph = self.graph.to_dict()

        filters: dict[str, Any] | None
        if isinstance(self.filters, GetApiGraphsByIdResponse200FiltersType0):
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
        from ..models.get_api_graphs_by_id_response_200_filters_type_0 import GetApiGraphsByIdResponse200FiltersType0
        from ..models.get_api_graphs_by_id_response_200_graph import GetApiGraphsByIdResponse200Graph

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        graph = GetApiGraphsByIdResponse200Graph.from_dict(d.pop("graph"))

        def _parse_filters(data: object) -> GetApiGraphsByIdResponse200FiltersType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                filters_type_0 = GetApiGraphsByIdResponse200FiltersType0.from_dict(data)

                return filters_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGraphsByIdResponse200FiltersType0 | None, data)

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

        get_api_graphs_by_id_response_200 = cls(
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

        get_api_graphs_by_id_response_200.additional_properties = d
        return get_api_graphs_by_id_response_200

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
