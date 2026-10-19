from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar(
    "T",
    bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3",
)


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType3:
    """
    Attributes:
        kind (Literal['api']):
    """

    kind: Literal["api"]

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["api"], d.pop("kind"))
        if kind != "api":
            raise ValueError(f"kind must match const 'api', got '{kind}'")

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_3 = cls(
            kind=kind,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_3
