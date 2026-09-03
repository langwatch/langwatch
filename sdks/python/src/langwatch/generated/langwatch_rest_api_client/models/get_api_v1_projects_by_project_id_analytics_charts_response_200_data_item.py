from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_projects_by_project_id_analytics_charts_response_200_data_item_definition import (
        GetApiV1ProjectsByProjectIdAnalyticsChartsResponse200DataItemDefinition,
    )


T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsChartsResponse200DataItem")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsChartsResponse200DataItem:
    """
    Attributes:
        id (str):
        name (str):
        definition (GetApiV1ProjectsByProjectIdAnalyticsChartsResponse200DataItemDefinition):
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
    definition: GetApiV1ProjectsByProjectIdAnalyticsChartsResponse200DataItemDefinition
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
        from ..models.get_api_v1_projects_by_project_id_analytics_charts_response_200_data_item_definition import (
            GetApiV1ProjectsByProjectIdAnalyticsChartsResponse200DataItemDefinition,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        definition = GetApiV1ProjectsByProjectIdAnalyticsChartsResponse200DataItemDefinition.from_dict(
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

        get_api_v1_projects_by_project_id_analytics_charts_response_200_data_item = cls(
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

        get_api_v1_projects_by_project_id_analytics_charts_response_200_data_item.additional_properties = d
        return get_api_v1_projects_by_project_id_analytics_charts_response_200_data_item

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
