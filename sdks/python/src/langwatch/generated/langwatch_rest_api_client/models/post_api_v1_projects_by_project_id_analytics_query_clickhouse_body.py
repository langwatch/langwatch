from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_body_parameters import (
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyParameters,
    )
    from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_body_time_window import (
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody:
    """
    Attributes:
        sql (str):
        parameters (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyParameters | Unset):
        time_window (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow | Unset):
        granularity_seconds (Literal[1] | Literal[3600] | Literal[60] | Unset):
    """

    sql: str
    parameters: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyParameters | Unset = UNSET
    time_window: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow | Unset = UNSET
    granularity_seconds: Literal[1] | Literal[3600] | Literal[60] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sql = self.sql

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        time_window: dict[str, Any] | Unset = UNSET
        if not isinstance(self.time_window, Unset):
            time_window = self.time_window.to_dict()

        granularity_seconds: Literal[1] | Literal[3600] | Literal[60] | Unset
        if isinstance(self.granularity_seconds, Unset):
            granularity_seconds = UNSET
        else:
            granularity_seconds = self.granularity_seconds

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sql": sql,
            }
        )
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if time_window is not UNSET:
            field_dict["timeWindow"] = time_window
        if granularity_seconds is not UNSET:
            field_dict["granularitySeconds"] = granularity_seconds

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_body_parameters import (
            PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyParameters,
        )
        from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_body_time_window import (
            PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow,
        )

        d = dict(src_dict)
        sql = d.pop("sql")

        _parameters = d.pop("parameters", UNSET)
        parameters: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyParameters.from_dict(_parameters)

        _time_window = d.pop("timeWindow", UNSET)
        time_window: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow | Unset
        if isinstance(_time_window, Unset):
            time_window = UNSET
        else:
            time_window = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow.from_dict(_time_window)

        def _parse_granularity_seconds(data: object) -> Literal[1] | Literal[3600] | Literal[60] | Unset:
            if isinstance(data, Unset):
                return data
            granularity_seconds_type_0 = cast(Literal[1], data)
            if granularity_seconds_type_0 != 1:
                raise ValueError(f"granularitySeconds_type_0 must match const 1, got '{granularity_seconds_type_0}'")
            return granularity_seconds_type_0
            granularity_seconds_type_1 = cast(Literal[60], data)
            if granularity_seconds_type_1 != 60:
                raise ValueError(f"granularitySeconds_type_1 must match const 60, got '{granularity_seconds_type_1}'")
            return granularity_seconds_type_1
            granularity_seconds_type_2 = cast(Literal[3600], data)
            if granularity_seconds_type_2 != 3600:
                raise ValueError(f"granularitySeconds_type_2 must match const 3600, got '{granularity_seconds_type_2}'")
            return granularity_seconds_type_2

        granularity_seconds = _parse_granularity_seconds(d.pop("granularitySeconds", UNSET))

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_body = cls(
            sql=sql,
            parameters=parameters,
            time_window=time_window,
            granularity_seconds=granularity_seconds,
        )

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_body.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_query_clickhouse_body

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
