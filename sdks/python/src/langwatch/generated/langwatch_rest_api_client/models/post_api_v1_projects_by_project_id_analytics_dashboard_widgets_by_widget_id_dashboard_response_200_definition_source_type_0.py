from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar(
    "T",
    bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0",
)


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse200DefinitionSourceType0:
    """
    Attributes:
        kind (Literal['catalogue']):
        catalogue_id (str):
    """

    kind: Literal["catalogue"]
    catalogue_id: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        catalogue_id = self.catalogue_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "catalogueId": catalogue_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["catalogue"], d.pop("kind"))
        if kind != "catalogue":
            raise ValueError(f"kind must match const 'catalogue', got '{kind}'")

        catalogue_id = d.pop("catalogueId")

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_0 = cls(
            kind=kind,
            catalogue_id=catalogue_id,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_dashboard_response_200_definition_source_type_0
