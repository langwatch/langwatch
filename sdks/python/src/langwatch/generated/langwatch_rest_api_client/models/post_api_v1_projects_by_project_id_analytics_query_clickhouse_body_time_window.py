from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBodyTimeWindow:
    """
    Attributes:
        start (float | str):
        end (float | str):
    """

    start: float | str
    end: float | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        start: float | str
        start = self.start

        end: float | str
        end = self.end

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "start": start,
                "end": end,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_start(data: object) -> float | str:
            return cast(float | str, data)

        start = _parse_start(d.pop("start"))

        def _parse_end(data: object) -> float | str:
            return cast(float | str, data)

        end = _parse_end(d.pop("end"))

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_body_time_window = cls(
            start=start,
            end=end,
        )

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_body_time_window.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_query_clickhouse_body_time_window

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
