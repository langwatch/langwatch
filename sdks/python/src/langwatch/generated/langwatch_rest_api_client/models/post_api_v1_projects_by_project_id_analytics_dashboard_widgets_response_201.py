from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201Definition,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201:
    """
    Attributes:
        id (str):
        name (str):
        definition (PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201Definition):
        created_at (str):
        updated_at (str):
        platform_url (str):
        dashboard_id (None | str):
        grid_column (int):
        grid_row (int):
        col_span (int):
        row_span (int):
    """

    id: str
    name: str
    definition: PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201Definition
    created_at: str
    updated_at: str
    platform_url: str
    dashboard_id: None | str
    grid_column: int
    grid_row: int
    col_span: int
    row_span: int

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        definition = self.definition.to_dict()

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        dashboard_id: None | str
        dashboard_id = self.dashboard_id

        grid_column = self.grid_column

        grid_row = self.grid_row

        col_span = self.col_span

        row_span = self.row_span

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "definition": definition,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
                "dashboardId": dashboard_id,
                "gridColumn": grid_column,
                "gridRow": grid_row,
                "colSpan": col_span,
                "rowSpan": row_span,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201Definition,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        definition = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201Definition.from_dict(
            d.pop("definition")
        )

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        def _parse_dashboard_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        dashboard_id = _parse_dashboard_id(d.pop("dashboardId"))

        grid_column = d.pop("gridColumn")

        grid_row = d.pop("gridRow")

        col_span = d.pop("colSpan")

        row_span = d.pop("rowSpan")

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201 = cls(
            id=id,
            name=name,
            definition=definition,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
            dashboard_id=dashboard_id,
            grid_column=grid_column,
            grid_row=grid_row,
            col_span=col_span,
            row_span=row_span,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201
