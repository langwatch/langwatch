from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_graphs_body_filters import PostApiGraphsBodyFilters
    from ..models.post_api_graphs_body_graph import PostApiGraphsBodyGraph


T = TypeVar("T", bound="PostApiGraphsBody")


@_attrs_define
class PostApiGraphsBody:
    """
    Attributes:
        name (str):
        graph (PostApiGraphsBodyGraph):
        dashboard_id (str | Unset):
        filters (PostApiGraphsBodyFilters | Unset):
        grid_column (float | Unset):
        grid_row (float | Unset):
        col_span (float | Unset):
        row_span (float | Unset):
    """

    name: str
    graph: PostApiGraphsBodyGraph
    dashboard_id: str | Unset = UNSET
    filters: PostApiGraphsBodyFilters | Unset = UNSET
    grid_column: float | Unset = UNSET
    grid_row: float | Unset = UNSET
    col_span: float | Unset = UNSET
    row_span: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        graph = self.graph.to_dict()

        dashboard_id = self.dashboard_id

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        grid_column = self.grid_column

        grid_row = self.grid_row

        col_span = self.col_span

        row_span = self.row_span

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "graph": graph,
            }
        )
        if dashboard_id is not UNSET:
            field_dict["dashboardId"] = dashboard_id
        if filters is not UNSET:
            field_dict["filters"] = filters
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
        from ..models.post_api_graphs_body_filters import PostApiGraphsBodyFilters
        from ..models.post_api_graphs_body_graph import PostApiGraphsBodyGraph

        d = dict(src_dict)
        name = d.pop("name")

        graph = PostApiGraphsBodyGraph.from_dict(d.pop("graph"))

        dashboard_id = d.pop("dashboardId", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: PostApiGraphsBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiGraphsBodyFilters.from_dict(_filters)

        grid_column = d.pop("gridColumn", UNSET)

        grid_row = d.pop("gridRow", UNSET)

        col_span = d.pop("colSpan", UNSET)

        row_span = d.pop("rowSpan", UNSET)

        post_api_graphs_body = cls(
            name=name,
            graph=graph,
            dashboard_id=dashboard_id,
            filters=filters,
            grid_column=grid_column,
            grid_row=grid_row,
            col_span=col_span,
            row_span=row_span,
        )

        post_api_graphs_body.additional_properties = d
        return post_api_graphs_body

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
