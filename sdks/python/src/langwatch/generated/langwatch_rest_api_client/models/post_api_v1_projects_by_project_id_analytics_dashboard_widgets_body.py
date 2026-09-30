from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body_queries_item import (
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBodyQueriesItem,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody:
    """
    Attributes:
        name (str):
        code (str):
        queries (list[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBodyQueriesItem]):
    """

    name: str
    code: str
    queries: list[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBodyQueriesItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        code = self.code

        queries = []
        for queries_item_data in self.queries:
            queries_item = queries_item_data.to_dict()
            queries.append(queries_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "code": code,
                "queries": queries,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body_queries_item import (
            PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBodyQueriesItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        code = d.pop("code")

        queries = []
        _queries = d.pop("queries")
        for queries_item_data in _queries:
            queries_item = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBodyQueriesItem.from_dict(
                queries_item_data
            )

            queries.append(queries_item)

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body = cls(
            name=name,
            code=code,
            queries=queries,
        )

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body

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
