from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body_queries_item import (
        PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodyQueriesItem,
    )


T = TypeVar("T", bound="PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody")


@_attrs_define
class PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody:
    """
    Attributes:
        name (str | Unset):
        code (str | Unset):
        queries (list[PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodyQueriesItem] | Unset):
    """

    name: str | Unset = UNSET
    code: str | Unset = UNSET
    queries: list[PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodyQueriesItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        code = self.code

        queries: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.queries, Unset):
            queries = []
            for queries_item_data in self.queries:
                queries_item = queries_item_data.to_dict()
                queries.append(queries_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if code is not UNSET:
            field_dict["code"] = code
        if queries is not UNSET:
            field_dict["queries"] = queries

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body_queries_item import (
            PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodyQueriesItem,
        )

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        code = d.pop("code", UNSET)

        _queries = d.pop("queries", UNSET)
        queries: list[PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodyQueriesItem] | Unset = UNSET
        if _queries is not UNSET:
            queries = []
            for queries_item_data in _queries:
                queries_item = (
                    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodyQueriesItem.from_dict(
                        queries_item_data
                    )
                )

                queries.append(queries_item)

        patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body = cls(
            name=name,
            code=code,
            queries=queries,
        )

        patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body.additional_properties = d
        return patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body

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
