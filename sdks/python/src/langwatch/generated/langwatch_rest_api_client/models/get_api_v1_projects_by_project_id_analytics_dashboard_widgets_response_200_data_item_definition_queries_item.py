from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item_parameters_item import (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItemParametersItem,
    )


T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItem:
    """
    Attributes:
        name (str):
        sql (str):
        parameters (list[GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItemPar
            ametersItem] | Unset):
    """

    name: str
    sql: str
    parameters: (
        list[GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItemParametersItem]
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
        from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item_parameters_item import (
            GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItemParametersItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        sql = d.pop("sql")

        _parameters = d.pop("parameters", UNSET)
        parameters: (
            list[
                GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItemParametersItem
            ]
            | Unset
        ) = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionQueriesItemParametersItem.from_dict(
                    parameters_item_data
                )

                parameters.append(parameters_item)

        get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item = (
            cls(
                name=name,
                sql=sql,
                parameters=parameters,
            )
        )

        return (
            get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_queries_item
        )
