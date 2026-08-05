from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_webhooks_v1_endpoints_response_200_data_item_status import (
    GetApiWebhooksV1EndpointsResponse200DataItemStatus,
)

T = TypeVar("T", bound="GetApiWebhooksV1EndpointsResponse200DataItem")


@_attrs_define
class GetApiWebhooksV1EndpointsResponse200DataItem:
    """
    Attributes:
        id (str):
        url (str):
        enabled_events (list[str]):
        status (GetApiWebhooksV1EndpointsResponse200DataItemStatus):
        disabled_reason (None | str):
        disabled_at (None | str):
        failing_since (None | str):
        last_success_at (None | str):
        last_failure_at (None | str):
        max_batch_size (int):
        max_batch_delay_ms (int):
        max_in_flight (int):
        created_at (str):
        updated_at (str):
    """

    id: str
    url: str
    enabled_events: list[str]
    status: GetApiWebhooksV1EndpointsResponse200DataItemStatus
    disabled_reason: None | str
    disabled_at: None | str
    failing_since: None | str
    last_success_at: None | str
    last_failure_at: None | str
    max_batch_size: int
    max_batch_delay_ms: int
    max_in_flight: int
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        url = self.url

        enabled_events = self.enabled_events

        status = self.status.value

        disabled_reason: None | str
        disabled_reason = self.disabled_reason

        disabled_at: None | str
        disabled_at = self.disabled_at

        failing_since: None | str
        failing_since = self.failing_since

        last_success_at: None | str
        last_success_at = self.last_success_at

        last_failure_at: None | str
        last_failure_at = self.last_failure_at

        max_batch_size = self.max_batch_size

        max_batch_delay_ms = self.max_batch_delay_ms

        max_in_flight = self.max_in_flight

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "url": url,
                "enabled_events": enabled_events,
                "status": status,
                "disabled_reason": disabled_reason,
                "disabled_at": disabled_at,
                "failing_since": failing_since,
                "last_success_at": last_success_at,
                "last_failure_at": last_failure_at,
                "max_batch_size": max_batch_size,
                "max_batch_delay_ms": max_batch_delay_ms,
                "max_in_flight": max_in_flight,
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        url = d.pop("url")

        enabled_events = cast(list[str], d.pop("enabled_events"))

        status = GetApiWebhooksV1EndpointsResponse200DataItemStatus(d.pop("status"))

        def _parse_disabled_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        disabled_reason = _parse_disabled_reason(d.pop("disabled_reason"))

        def _parse_disabled_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        disabled_at = _parse_disabled_at(d.pop("disabled_at"))

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

        max_batch_size = d.pop("max_batch_size")

        max_batch_delay_ms = d.pop("max_batch_delay_ms")

        max_in_flight = d.pop("max_in_flight")

        created_at = d.pop("created_at")

        updated_at = d.pop("updated_at")

        get_api_webhooks_v1_endpoints_response_200_data_item = cls(
            id=id,
            url=url,
            enabled_events=enabled_events,
            status=status,
            disabled_reason=disabled_reason,
            disabled_at=disabled_at,
            failing_since=failing_since,
            last_success_at=last_success_at,
            last_failure_at=last_failure_at,
            max_batch_size=max_batch_size,
            max_batch_delay_ms=max_batch_delay_ms,
            max_in_flight=max_in_flight,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_api_webhooks_v1_endpoints_response_200_data_item.additional_properties = d
        return get_api_webhooks_v1_endpoints_response_200_data_item

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
