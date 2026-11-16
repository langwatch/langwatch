from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_200_definition_parameters import (
        PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionParameters,
    )
    from ..models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_200_definition_vega_lite_spec import (
        PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionVegaLiteSpec,
    )


T = TypeVar("T", bound="PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200Definition")


@_attrs_define
class PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200Definition:
    """
    Attributes:
        version (float):
        sql (str):
        parameters (PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionParameters):
        vega_lite_spec (PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionVegaLiteSpec |
            Unset):
    """

    version: float
    sql: str
    parameters: PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionParameters
    vega_lite_spec: (
        PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionVegaLiteSpec | Unset
    ) = UNSET

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
        from ..models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_200_definition_parameters import (
            PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionParameters,
        )
        from ..models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_200_definition_vega_lite_spec import (
            PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionVegaLiteSpec,
        )

        d = dict(src_dict)
        version = d.pop("version")

        sql = d.pop("sql")

        parameters = (
            PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionParameters.from_dict(
                d.pop("parameters")
            )
        )

        _vega_lite_spec = d.pop("vegaLiteSpec", UNSET)
        vega_lite_spec: (
            PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionVegaLiteSpec | Unset
        )
        if isinstance(_vega_lite_spec, Unset):
            vega_lite_spec = UNSET
        else:
            vega_lite_spec = (
                PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200DefinitionVegaLiteSpec.from_dict(
                    _vega_lite_spec
                )
            )

        put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_200_definition = cls(
            version=version,
            sql=sql,
            parameters=parameters,
            vega_lite_spec=vega_lite_spec,
        )

        return put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_200_definition
