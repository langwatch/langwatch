from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        sql = self.sql

        parameters = self.parameters.to_dict()

        vega_lite_spec: dict[str, Any] | Unset = UNSET
        if not isinstance(self.vega_lite_spec, Unset):
            vega_lite_spec = self.vega_lite_spec.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_v1_projects_by_project_id_analytics_charts_response_201_definition.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_charts_response_201_definition

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
