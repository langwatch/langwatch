from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_dashboards_by_dashboard_id_widgets_body_queries_item_sources_type_0_item import (
    PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemSourcesType0Item,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dashboards_by_dashboard_id_widgets_body_queries_item_parameters_item import (
        PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemParametersItem,
    )


T = TypeVar("T", bound="PostApiDashboardsByDashboardIdWidgetsBodyQueriesItem")


@_attrs_define
class PostApiDashboardsByDashboardIdWidgetsBodyQueriesItem:
    """
    Attributes:
        name (str):
        sql (str):
        parameters (list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemParametersItem] | Unset):
        sources (list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemSourcesType0Item] | None | Unset):
    """

    name: str
    sql: str
    parameters: list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemParametersItem] | Unset = UNSET
    sources: list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemSourcesType0Item] | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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
        field_dict.update(self.additional_properties)
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
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_queries_item_parameters_item import (
            PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemParametersItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        sql = d.pop("sql")

        _parameters = d.pop("parameters", UNSET)
        parameters: list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemParametersItem.from_dict(
                    parameters_item_data
                )

                parameters.append(parameters_item)

        def _parse_sources(
            data: object,
        ) -> list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemSourcesType0Item] | None | Unset:
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
                    sources_type_0_item = PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemSourcesType0Item(
                        sources_type_0_item_data
                    )

                    sources_type_0.append(sources_type_0_item)

                return sources_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItemSourcesType0Item] | None | Unset, data)

        sources = _parse_sources(d.pop("sources", UNSET))

        post_api_dashboards_by_dashboard_id_widgets_body_queries_item = cls(
            name=name,
            sql=sql,
            parameters=parameters,
            sources=sources,
        )

        post_api_dashboards_by_dashboard_id_widgets_body_queries_item.additional_properties = d
        return post_api_dashboards_by_dashboard_id_widgets_body_queries_item

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
