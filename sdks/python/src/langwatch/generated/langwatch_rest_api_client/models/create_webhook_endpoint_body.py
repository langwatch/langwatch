from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateWebhookEndpointBody")


@_attrs_define
class CreateWebhookEndpointBody:
    """
    Attributes:
        url (str):
        enabled_events (list[str]):
        max_batch_size (int | Unset):
        max_batch_delay_ms (int | Unset):
        max_in_flight (int | Unset):
    """

    url: str
    enabled_events: list[str]
    max_batch_size: int | Unset = UNSET
    max_batch_delay_ms: int | Unset = UNSET
    max_in_flight: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        enabled_events = self.enabled_events

        max_batch_size = self.max_batch_size

        max_batch_delay_ms = self.max_batch_delay_ms

        max_in_flight = self.max_in_flight

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "url": url,
                "enabled_events": enabled_events,
            }
        )
        if max_batch_size is not UNSET:
            field_dict["max_batch_size"] = max_batch_size
        if max_batch_delay_ms is not UNSET:
            field_dict["max_batch_delay_ms"] = max_batch_delay_ms
        if max_in_flight is not UNSET:
            field_dict["max_in_flight"] = max_in_flight

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        enabled_events = cast(list[str], d.pop("enabled_events"))

        max_batch_size = d.pop("max_batch_size", UNSET)

        max_batch_delay_ms = d.pop("max_batch_delay_ms", UNSET)

        max_in_flight = d.pop("max_in_flight", UNSET)

        create_webhook_endpoint_body = cls(
            url=url,
            enabled_events=enabled_events,
            max_batch_size=max_batch_size,
            max_batch_delay_ms=max_batch_delay_ms,
            max_in_flight=max_in_flight,
        )

        create_webhook_endpoint_body.additional_properties = d
        return create_webhook_endpoint_body

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
