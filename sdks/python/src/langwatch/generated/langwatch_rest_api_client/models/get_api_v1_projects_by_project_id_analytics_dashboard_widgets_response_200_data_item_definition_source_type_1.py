from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse200DataItemDefinitionSourceType1:
    """
    Attributes:
        kind (Literal['langy']):
    """

    kind: Literal["langy"]

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
        kind = cast(Literal["langy"], d.pop("kind"))
        if kind != "langy":
            raise ValueError(f"kind must match const 'langy', got '{kind}'")

        get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_1 = cls(
            kind=kind,
        )

        return get_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_200_data_item_definition_source_type_1
