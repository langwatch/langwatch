from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_webhooks_v1_endpoints_by_id_health_response_200_data_status import (
    GetApiWebhooksV1EndpointsByIdHealthResponse200DataStatus,
)

T = TypeVar("T", bound="GetApiWebhooksV1EndpointsByIdHealthResponse200Data")


@_attrs_define
class GetApiWebhooksV1EndpointsByIdHealthResponse200Data:
    """
    Attributes:
        status (GetApiWebhooksV1EndpointsByIdHealthResponse200DataStatus):
        disabled_reason (None | str):
        failing_since (None | str):
        last_success_at (None | str):
        last_failure_at (None | str):
        oldest_undelivered_age_ms (int | None):
        dlq_depth (int):
        sends_per_minute (float):
        success_rate (float | None):
        p95_latency_ms (int | None):
    """

    status: GetApiWebhooksV1EndpointsByIdHealthResponse200DataStatus
    disabled_reason: None | str
    failing_since: None | str
    last_success_at: None | str
    last_failure_at: None | str
    oldest_undelivered_age_ms: int | None
    dlq_depth: int
    sends_per_minute: float
    success_rate: float | None
    p95_latency_ms: int | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        disabled_reason: None | str
        disabled_reason = self.disabled_reason

        failing_since: None | str
        failing_since = self.failing_since

        last_success_at: None | str
        last_success_at = self.last_success_at

        last_failure_at: None | str
        last_failure_at = self.last_failure_at

        oldest_undelivered_age_ms: int | None
        oldest_undelivered_age_ms = self.oldest_undelivered_age_ms

        dlq_depth = self.dlq_depth

        sends_per_minute = self.sends_per_minute

        success_rate: float | None
        success_rate = self.success_rate

        p95_latency_ms: int | None
        p95_latency_ms = self.p95_latency_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "disabled_reason": disabled_reason,
                "failing_since": failing_since,
                "last_success_at": last_success_at,
                "last_failure_at": last_failure_at,
                "oldest_undelivered_age_ms": oldest_undelivered_age_ms,
                "dlq_depth": dlq_depth,
                "sends_per_minute": sends_per_minute,
                "success_rate": success_rate,
                "p95_latency_ms": p95_latency_ms,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = GetApiWebhooksV1EndpointsByIdHealthResponse200DataStatus(d.pop("status"))

        def _parse_disabled_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        disabled_reason = _parse_disabled_reason(d.pop("disabled_reason"))

        def _parse_failing_since(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        failing_since = _parse_failing_since(d.pop("failing_since"))

        def _parse_last_success_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_success_at = _parse_last_success_at(d.pop("last_success_at"))

        def _parse_last_failure_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_failure_at = _parse_last_failure_at(d.pop("last_failure_at"))

        def _parse_oldest_undelivered_age_ms(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        oldest_undelivered_age_ms = _parse_oldest_undelivered_age_ms(d.pop("oldest_undelivered_age_ms"))

        dlq_depth = d.pop("dlq_depth")

        sends_per_minute = d.pop("sends_per_minute")

        def _parse_success_rate(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        success_rate = _parse_success_rate(d.pop("success_rate"))

        def _parse_p95_latency_ms(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        p95_latency_ms = _parse_p95_latency_ms(d.pop("p95_latency_ms"))

        get_api_webhooks_v1_endpoints_by_id_health_response_200_data = cls(
            status=status,
            disabled_reason=disabled_reason,
            failing_since=failing_since,
            last_success_at=last_success_at,
            last_failure_at=last_failure_at,
            oldest_undelivered_age_ms=oldest_undelivered_age_ms,
            dlq_depth=dlq_depth,
            sends_per_minute=sends_per_minute,
            success_rate=success_rate,
            p95_latency_ms=p95_latency_ms,
        )

        get_api_webhooks_v1_endpoints_by_id_health_response_200_data.additional_properties = d
        return get_api_webhooks_v1_endpoints_by_id_health_response_200_data

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
