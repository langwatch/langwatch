from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_triggers_by_id_enable_response_200_graph_alert_type_0_operator import (
    PostApiTriggersByIdEnableResponse200GraphAlertType0Operator,
)

T = TypeVar("T", bound="PostApiTriggersByIdEnableResponse200GraphAlertType0")


@_attrs_define
class PostApiTriggersByIdEnableResponse200GraphAlertType0:
    """The rule an alert fires by. Null for anything that is not one.

    Attributes:
        threshold (float):
        operator (PostApiTriggersByIdEnableResponse200GraphAlertType0Operator):
        time_period (Literal[1440] | Literal[15] | Literal[1] | Literal[30] | Literal[5] | Literal[60]):
        series_name (str):
    """

    threshold: float
    operator: PostApiTriggersByIdEnableResponse200GraphAlertType0Operator
    time_period: Literal[1440] | Literal[15] | Literal[1] | Literal[30] | Literal[5] | Literal[60]
    series_name: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        threshold = self.threshold

        operator = self.operator.value

        time_period: Literal[1440] | Literal[15] | Literal[1] | Literal[30] | Literal[5] | Literal[60]
        time_period = self.time_period

        series_name = self.series_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "threshold": threshold,
                "operator": operator,
                "timePeriod": time_period,
                "seriesName": series_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        threshold = d.pop("threshold")

        operator = PostApiTriggersByIdEnableResponse200GraphAlertType0Operator(d.pop("operator"))

        def _parse_time_period(
            data: object,
        ) -> Literal[1440] | Literal[15] | Literal[1] | Literal[30] | Literal[5] | Literal[60]:
            time_period_type_0 = cast(Literal[1], data)
            if time_period_type_0 != 1:
                raise ValueError(f"timePeriod_type_0 must match const 1, got '{time_period_type_0}'")
            return time_period_type_0
            time_period_type_1 = cast(Literal[5], data)
            if time_period_type_1 != 5:
                raise ValueError(f"timePeriod_type_1 must match const 5, got '{time_period_type_1}'")
            return time_period_type_1
            time_period_type_2 = cast(Literal[15], data)
            if time_period_type_2 != 15:
                raise ValueError(f"timePeriod_type_2 must match const 15, got '{time_period_type_2}'")
            return time_period_type_2
            time_period_type_3 = cast(Literal[30], data)
            if time_period_type_3 != 30:
                raise ValueError(f"timePeriod_type_3 must match const 30, got '{time_period_type_3}'")
            return time_period_type_3
            time_period_type_4 = cast(Literal[60], data)
            if time_period_type_4 != 60:
                raise ValueError(f"timePeriod_type_4 must match const 60, got '{time_period_type_4}'")
            return time_period_type_4
            time_period_type_5 = cast(Literal[1440], data)
            if time_period_type_5 != 1440:
                raise ValueError(f"timePeriod_type_5 must match const 1440, got '{time_period_type_5}'")
            return time_period_type_5

        time_period = _parse_time_period(d.pop("timePeriod"))

        series_name = d.pop("seriesName")

        post_api_triggers_by_id_enable_response_200_graph_alert_type_0 = cls(
            threshold=threshold,
            operator=operator,
            time_period=time_period,
            series_name=series_name,
        )

        post_api_triggers_by_id_enable_response_200_graph_alert_type_0.additional_properties = d
        return post_api_triggers_by_id_enable_response_200_graph_alert_type_0

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
