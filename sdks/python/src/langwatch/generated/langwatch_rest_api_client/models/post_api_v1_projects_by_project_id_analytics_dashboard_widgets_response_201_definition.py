from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition_queries_item import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItem,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201Definition")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201Definition:
    """
    Attributes:
        version (float):
        code (str):
        queries (list[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItem]):
    """

    version: float
    code: str
    queries: list[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItem]

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
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition_queries_item import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItem,
        )

        d = dict(src_dict)
        version = d.pop("version")

        code = d.pop("code")

        queries = []
        _queries = d.pop("queries")
        for queries_item_data in _queries:
            queries_item = (
                PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItem.from_dict(
                    queries_item_data
                )
            )

            queries.append(queries_item)

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition = cls(
            version=version,
            code=code,
            queries=queries,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition
