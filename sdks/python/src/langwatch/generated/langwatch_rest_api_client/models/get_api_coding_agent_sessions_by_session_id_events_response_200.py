from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_coding_agent_sessions_by_session_id_events_response_200_events_item import (
        GetApiCodingAgentSessionsBySessionIdEventsResponse200EventsItem,
    )


T = TypeVar("T", bound="GetApiCodingAgentSessionsBySessionIdEventsResponse200")


@_attrs_define
class GetApiCodingAgentSessionsBySessionIdEventsResponse200:
    """
    Attributes:
        events (list[GetApiCodingAgentSessionsBySessionIdEventsResponse200EventsItem]):
        next_cursor (None | str):
    """

    events: list[GetApiCodingAgentSessionsBySessionIdEventsResponse200EventsItem]
    next_cursor: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        events = []
        for events_item_data in self.events:
            events_item = events_item_data.to_dict()
            events.append(events_item)

        next_cursor: None | str
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "events": events,
                "nextCursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_coding_agent_sessions_by_session_id_events_response_200_events_item import (
            GetApiCodingAgentSessionsBySessionIdEventsResponse200EventsItem,
        )

        d = dict(src_dict)
        events = []
        _events = d.pop("events")
        for events_item_data in _events:
            events_item = GetApiCodingAgentSessionsBySessionIdEventsResponse200EventsItem.from_dict(events_item_data)

            events.append(events_item)

        def _parse_next_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        get_api_coding_agent_sessions_by_session_id_events_response_200 = cls(
            events=events,
            next_cursor=next_cursor,
        )

        get_api_coding_agent_sessions_by_session_id_events_response_200.additional_properties = d
        return get_api_coding_agent_sessions_by_session_id_events_response_200

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
