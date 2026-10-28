from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_0 import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_1 import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_2 import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_3 import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3,
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
        description (str | Unset):
        prompt (str | Unset):
        source (PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0
            | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1 |
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2 |
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3 |
            Unset):
    """

    version: float
    code: str
    queries: list[
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem
    ]
    description: str | Unset = UNSET
    prompt: str | Unset = UNSET
    source: (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0
        | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1
        | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2
        | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3
        | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_0 import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_1 import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_2 import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2,
        )

        version = self.version

        code = self.code

        queries = []
        for queries_item_data in self.queries:
            queries_item = queries_item_data.to_dict()
            queries.append(queries_item)

        description = self.description

        prompt = self.prompt

        source: dict[str, Any] | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(
            self.source,
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0,
        ):
            source = self.source.to_dict()
        elif isinstance(
            self.source,
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1,
        ):
            source = self.source.to_dict()
        elif isinstance(
            self.source,
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2,
        ):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "code": code,
                "queries": queries,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_queries_item import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionQueriesItem,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_0 import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_1 import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_2 import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_3 import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3,
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

        description = d.pop("description", UNSET)

        prompt = d.pop("prompt", UNSET)

        def _parse_source(
            data: object,
        ) -> (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0
            | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1
            | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2
            | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0.from_dict(
                    data
                )

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType1.from_dict(
                    data
                )

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_2 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType2.from_dict(
                    data
                )

                return source_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_3 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3.from_dict(
                data
            )

            return source_type_3

        source = _parse_source(d.pop("source", UNSET))

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition = cls(
            version=version,
            code=code,
            queries=queries,
            description=description,
            prompt=prompt,
            source=source,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition
