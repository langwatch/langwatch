from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item import (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem,
    )


T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinition")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinition:
    """
    Attributes:
        version (float):
        code (str):
        queries (list[GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem]):
    """

    version: float
    code: str
    queries: list[GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem]

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
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem,
        )

        d = dict(src_dict)
        version = d.pop("version")

        code = d.pop("code")

        queries = []
        _queries = d.pop("queries")
        for queries_item_data in _queries:
            queries_item = (
                GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem.from_dict(
                    queries_item_data
                )
            )

            queries.append(queries_item)

        get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition = cls(
            version=version,
            code=code,
            queries=queries,
        )

        return get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition
