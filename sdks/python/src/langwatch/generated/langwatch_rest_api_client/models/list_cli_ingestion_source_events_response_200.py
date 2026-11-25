from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_cli_ingestion_source_events_response_200_events_item import (
        ListCliIngestionSourceEventsResponse200EventsItem,
    )


T = TypeVar("T", bound="ListCliIngestionSourceEventsResponse200")


@_attrs_define
class ListCliIngestionSourceEventsResponse200:
    """
    Attributes:
        events (list[ListCliIngestionSourceEventsResponse200EventsItem]):
    """

    events: list[ListCliIngestionSourceEventsResponse200EventsItem]

    def to_dict(self) -> dict[str, Any]:
        events = []
        for events_item_data in self.events:
            events_item = events_item_data.to_dict()
            events.append(events_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "events": events,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_cli_ingestion_source_events_response_200_events_item import (
            ListCliIngestionSourceEventsResponse200EventsItem,
        )

        d = dict(src_dict)
        events = []
        _events = d.pop("events")
        for events_item_data in _events:
            events_item = ListCliIngestionSourceEventsResponse200EventsItem.from_dict(events_item_data)

            events.append(events_item)

        list_cli_ingestion_source_events_response_200 = cls(
            events=events,
        )

        return list_cli_ingestion_source_events_response_200
