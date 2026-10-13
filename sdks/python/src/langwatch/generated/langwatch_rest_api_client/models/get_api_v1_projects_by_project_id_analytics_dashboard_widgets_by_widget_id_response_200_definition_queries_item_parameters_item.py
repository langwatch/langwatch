from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_200_definition_queries_item_parameters_item_type import (
    GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200DefinitionQueriesItemParametersItemType,
)
from ..types import UNSET, Unset

T = TypeVar(
    "T",
    bound="GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200DefinitionQueriesItemParametersItem",
)


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200DefinitionQueriesItemParametersItem:
    """
    Attributes:
        name (str):
        type_ (GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200DefinitionQueriesItemParametersI
            temType):
        default (bool | float | str | Unset):
    """

    name: str
    type_: (
        GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200DefinitionQueriesItemParametersItemType
    )
    default: bool | float | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        default: bool | float | str | Unset
        if isinstance(self.default, Unset):
            default = UNSET
        else:
            default = self.default

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )
        if default is not UNSET:
            field_dict["default"] = default

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = GetApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200DefinitionQueriesItemParametersItemType(
            d.pop("type")
        )

        def _parse_default(data: object) -> bool | float | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(bool | float | str | Unset, data)

        default = _parse_default(d.pop("default", UNSET))

        get_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_200_definition_queries_item_parameters_item = cls(
            name=name,
            type_=type_,
            default=default,
        )

        return get_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_200_definition_queries_item_parameters_item
