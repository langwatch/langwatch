from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item import (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem,
    )
    from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_0 import (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0,
    )
    from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_1 import (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1,
    )
    from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_2 import (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2,
    )
    from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_3 import (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType3,
    )


T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinition")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinition:
    """
    Attributes:
        version (float):
        code (str):
        queries (list[GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem]):
        description (str | Unset):
        prompt (str | Unset):
        source (GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0 |
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1 |
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2 |
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType3 | Unset):
    """

    version: float
    code: str
    queries: list[GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem]
    description: str | Unset = UNSET
    prompt: str | Unset = UNSET
    source: (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0
        | GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1
        | GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2
        | GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType3
        | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_0 import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0,
        )
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_1 import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1,
        )
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_2 import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2,
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
            self.source, GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0
        ):
            source = self.source.to_dict()
        elif isinstance(
            self.source, GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1
        ):
            source = self.source.to_dict()
        elif isinstance(
            self.source, GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2
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
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem,
        )
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_0 import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0,
        )
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_1 import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1,
        )
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_2 import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2,
        )
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_3 import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType3,
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

        description = d.pop("description", UNSET)

        prompt = d.pop("prompt", UNSET)

        def _parse_source(
            data: object,
        ) -> (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0
            | GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1
            | GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2
            | GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType0.from_dict(
                    data
                )

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1.from_dict(
                    data
                )

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_2 = GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType2.from_dict(
                    data
                )

                return source_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_3 = (
                GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType3.from_dict(
                    data
                )
            )

            return source_type_3

        source = _parse_source(d.pop("source", UNSET))

        get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition = cls(
            version=version,
            code=code,
            queries=queries,
            description=description,
            prompt=prompt,
            source=source,
        )

        return get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition
