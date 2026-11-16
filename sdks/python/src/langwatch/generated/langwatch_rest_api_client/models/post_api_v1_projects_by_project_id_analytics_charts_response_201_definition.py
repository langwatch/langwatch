from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_charts_response_201_definition_parameters import (
        PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionParameters,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_charts_response_201_definition_vega_lite_spec import (
        PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionVegaLiteSpec,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201Definition")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201Definition:
    """
    Attributes:
        version (float):
        sql (str):
        parameters (PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionParameters):
        vega_lite_spec (PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionVegaLiteSpec | Unset):
    """

    version: float
    sql: str
    parameters: PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionParameters
    vega_lite_spec: PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionVegaLiteSpec | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        sql = self.sql

        parameters = self.parameters.to_dict()

        vega_lite_spec: dict[str, Any] | Unset = UNSET
        if not isinstance(self.vega_lite_spec, Unset):
            vega_lite_spec = self.vega_lite_spec.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "sql": sql,
                "parameters": parameters,
            }
        )
        if vega_lite_spec is not UNSET:
            field_dict["vegaLiteSpec"] = vega_lite_spec

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_charts_response_201_definition_parameters import (
            PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionParameters,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_charts_response_201_definition_vega_lite_spec import (
            PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionVegaLiteSpec,
        )

        d = dict(src_dict)
        version = d.pop("version")

        sql = d.pop("sql")

        parameters = PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionParameters.from_dict(
            d.pop("parameters")
        )

        _vega_lite_spec = d.pop("vegaLiteSpec", UNSET)
        vega_lite_spec: PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionVegaLiteSpec | Unset
        if isinstance(_vega_lite_spec, Unset):
            vega_lite_spec = UNSET
        else:
            vega_lite_spec = PostApiV1ProjectsByProjectIdAnalyticsChartsResponse201DefinitionVegaLiteSpec.from_dict(
                _vega_lite_spec
            )

        post_api_v1_projects_by_project_id_analytics_charts_response_201_definition = cls(
            version=version,
            sql=sql,
            parameters=parameters,
            vega_lite_spec=vega_lite_spec,
        )

        return post_api_v1_projects_by_project_id_analytics_charts_response_201_definition
