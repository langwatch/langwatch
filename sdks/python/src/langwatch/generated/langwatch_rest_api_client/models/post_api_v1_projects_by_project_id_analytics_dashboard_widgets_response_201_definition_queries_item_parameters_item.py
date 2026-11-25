from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition_queries_item_parameters_item_type import (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItemParametersItemType,
)
from ..types import UNSET, Unset

T = TypeVar(
    "T", bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItemParametersItem"
)


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItemParametersItem:
    """
    Attributes:
        name (str):
        type_ (PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItemParametersItemType):
        default (bool | float | str | Unset):
    """

    name: str
    type_: PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItemParametersItemType
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

        type_ = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201DefinitionQueriesItemParametersItemType(
            d.pop("type")
        )

        def _parse_default(data: object) -> bool | float | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(bool | float | str | Unset, data)

        default = _parse_default(d.pop("default", UNSET))

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition_queries_item_parameters_item = cls(
            name=name,
            type_=type_,
            default=default,
        )

        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201_definition_queries_item_parameters_item
