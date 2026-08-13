from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.list_webhook_endpoint_deliveries_response_200_data_item_outcome import (
    ListWebhookEndpointDeliveriesResponse200DataItemOutcome,
)

T = TypeVar("T", bound="ListWebhookEndpointDeliveriesResponse200DataItem")


@_attrs_define
class ListWebhookEndpointDeliveriesResponse200DataItem:
    """
    Attributes:
        id (str):
        dispatch_id (str):
        attempt (int):
        event_count (int):
        outcome (ListWebhookEndpointDeliveriesResponse200DataItemOutcome):
        response_status (int | None):
        latency_ms (int | None):
        error (None | str):
        fired_at (str):
    """

    id: str
    dispatch_id: str
    attempt: int
    event_count: int
    outcome: ListWebhookEndpointDeliveriesResponse200DataItemOutcome
    response_status: int | None
    latency_ms: int | None
    error: None | str
    fired_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        dispatch_id = self.dispatch_id

        attempt = self.attempt

        event_count = self.event_count

        outcome = self.outcome.value

        response_status: int | None
        response_status = self.response_status

        latency_ms: int | None
        latency_ms = self.latency_ms

        error: None | str
        error = self.error

        fired_at = self.fired_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "dispatch_id": dispatch_id,
                "attempt": attempt,
                "event_count": event_count,
                "outcome": outcome,
                "response_status": response_status,
                "latency_ms": latency_ms,
                "error": error,
                "fired_at": fired_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        dispatch_id = d.pop("dispatch_id")

        attempt = d.pop("attempt")

        event_count = d.pop("event_count")

        outcome = ListWebhookEndpointDeliveriesResponse200DataItemOutcome(d.pop("outcome"))

        def _parse_response_status(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        response_status = _parse_response_status(d.pop("response_status"))

        def _parse_latency_ms(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        latency_ms = _parse_latency_ms(d.pop("latency_ms"))

        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))

        fired_at = d.pop("fired_at")

        list_webhook_endpoint_deliveries_response_200_data_item = cls(
            id=id,
            dispatch_id=dispatch_id,
            attempt=attempt,
            event_count=event_count,
            outcome=outcome,
            response_status=response_status,
            latency_ms=latency_ms,
            error=error,
            fired_at=fired_at,
        )

        list_webhook_endpoint_deliveries_response_200_data_item.additional_properties = d
        return list_webhook_endpoint_deliveries_response_200_data_item

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
