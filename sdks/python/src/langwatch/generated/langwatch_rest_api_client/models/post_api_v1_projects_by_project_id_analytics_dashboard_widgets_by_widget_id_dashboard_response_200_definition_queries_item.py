from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item_parameters_item import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItemParametersItem,
    )


T = TypeVar(
    "T",
    bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem",
)


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem:
    """
    Attributes:
        name (str):
        sql (str):
        parameters (list[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQu
            eriesItemParametersItem] | Unset):
    """

    name: str
    sql: str
    parameters: (
        list[
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItemParametersItem
        ]
        | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        sql = self.sql

        parameters: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = []
            for parameters_item_data in self.parameters:
                parameters_item = parameters_item_data.to_dict()
                parameters.append(parameters_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "sql": sql,
            }
        )
        if parameters is not UNSET:
            field_dict["parameters"] = parameters

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item_parameters_item import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItemParametersItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        sql = d.pop("sql")

        _parameters = d.pop("parameters", UNSET)
        parameters: (
            list[
                PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItemParametersItem
            ]
            | Unset
        ) = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItemParametersItem.from_dict(
                    parameters_item_data
                )

                parameters.append(parameters_item)

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item = cls(
            name=name,
            sql=sql,
            parameters=parameters,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item
