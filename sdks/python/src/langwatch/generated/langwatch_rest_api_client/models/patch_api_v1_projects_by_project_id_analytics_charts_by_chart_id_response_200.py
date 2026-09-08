from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_200_definition import (
        PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse200Definition,
    )


T = TypeVar("T", bound="PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse200")


@_attrs_define
class PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        definition (PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse200Definition):
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
    definition: PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse200Definition
    created_at: str
    updated_at: str
    platform_url: str
    dashboard_id: None | str
    grid_column: int
    grid_row: int
    col_span: int
    row_span: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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
        field_dict.update(self.additional_properties)
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
        from ..models.patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_200_definition import (
            PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse200Definition,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        definition = PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse200Definition.from_dict(
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

        patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_200 = cls(
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

        patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_200.additional_properties = d
        return patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_200

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
