from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_dashboards_by_dashboard_id_widgets_response_200_data_item_definition_queries_item_sources_type_0_item import (
    GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemSourcesType0Item,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_dashboards_by_dashboard_id_widgets_response_200_data_item_definition_queries_item_parameters_item import (
        GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemParametersItem,
    )


T = TypeVar("T", bound="GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItem")


@_attrs_define
class GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItem:
    """
    Attributes:
        name (str):
        sql (str):
        parameters (list[GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemParametersItem] |
            Unset):
        sources (list[GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemSourcesType0Item] |
            None | Unset):
    """

    name: str
    sql: str
    parameters: (
        list[GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemParametersItem] | Unset
    ) = UNSET
    sources: (
        list[GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemSourcesType0Item]
        | None
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

        sources: list[str] | None | Unset
        if isinstance(self.sources, Unset):
            sources = UNSET
        elif isinstance(self.sources, list):
            sources = []
            for sources_type_0_item_data in self.sources:
                sources_type_0_item = sources_type_0_item_data.value
                sources.append(sources_type_0_item)

        else:
            sources = self.sources

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "sql": sql,
            }
        )
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if sources is not UNSET:
            field_dict["sources"] = sources

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dashboards_by_dashboard_id_widgets_response_200_data_item_definition_queries_item_parameters_item import (
            GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemParametersItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        sql = d.pop("sql")

        _parameters = d.pop("parameters", UNSET)
        parameters: (
            list[GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemParametersItem] | Unset
        ) = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemParametersItem.from_dict(
                    parameters_item_data
                )

                parameters.append(parameters_item)

        def _parse_sources(
            data: object,
        ) -> (
            list[GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemSourcesType0Item]
            | None
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                sources_type_0 = []
                _sources_type_0 = data
                for sources_type_0_item_data in _sources_type_0:
                    sources_type_0_item = (
                        GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemSourcesType0Item(
                            sources_type_0_item_data
                        )
                    )

                    sources_type_0.append(sources_type_0_item)

                return sources_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                list[GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemSourcesType0Item]
                | None
                | Unset,
                data,
            )

        sources = _parse_sources(d.pop("sources", UNSET))

        get_api_dashboards_by_dashboard_id_widgets_response_200_data_item_definition_queries_item = cls(
            name=name,
            sql=sql,
            parameters=parameters,
            sources=sources,
        )

        return get_api_dashboards_by_dashboard_id_widgets_response_200_data_item_definition_queries_item
