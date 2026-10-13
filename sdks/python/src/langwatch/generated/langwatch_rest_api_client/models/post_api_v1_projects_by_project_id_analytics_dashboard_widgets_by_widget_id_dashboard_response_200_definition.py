from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200Definition")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200Definition:
    """
    Attributes:
        version (float):
        code (str):
        queries (list[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueri
            esItem]):
    """

    version: float
    code: str
    queries: list[
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem
    ]

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        code = self.code

        queries = []
        for queries_item_data in self.queries:
            queries_item = queries_item_data.to_dict()
            queries.append(queries_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "code": code,
                "queries": queries,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem,
        )

        d = dict(src_dict)
        version = d.pop("version")

        code = d.pop("code")

        queries = []
        _queries = d.pop("queries")
        for queries_item_data in _queries:
            queries_item = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem.from_dict(
                queries_item_data
            )

            queries.append(queries_item)

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition = cls(
            version=version,
            code=code,
            queries=queries,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition
