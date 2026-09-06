from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_traces_by_trace_id_transcript_response_200_entries_item import (
        GetApiTracesByTraceIdTranscriptResponse200EntriesItem,
    )
    from ..models.get_api_traces_by_trace_id_transcript_response_200_sub_agents_item import (
        GetApiTracesByTraceIdTranscriptResponse200SubAgentsItem,
    )
    from ..models.get_api_traces_by_trace_id_transcript_response_200_totals import (
        GetApiTracesByTraceIdTranscriptResponse200Totals,
    )


T = TypeVar("T", bound="GetApiTracesByTraceIdTranscriptResponse200")


@_attrs_define
class GetApiTracesByTraceIdTranscriptResponse200:
    """
    Attributes:
        agent (str):
        session_id (None | str):
        entries (list[GetApiTracesByTraceIdTranscriptResponse200EntriesItem]):
        totals (GetApiTracesByTraceIdTranscriptResponse200Totals):
        sub_agents (list[GetApiTracesByTraceIdTranscriptResponse200SubAgentsItem]):
    """

    agent: str
    session_id: None | str
    entries: list[GetApiTracesByTraceIdTranscriptResponse200EntriesItem]
    totals: GetApiTracesByTraceIdTranscriptResponse200Totals
    sub_agents: list[GetApiTracesByTraceIdTranscriptResponse200SubAgentsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent = self.agent

        session_id: None | str
        session_id = self.session_id

        entries = []
        for entries_item_data in self.entries:
            entries_item = entries_item_data.to_dict()
            entries.append(entries_item)

        totals = self.totals.to_dict()

        sub_agents = []
        for sub_agents_item_data in self.sub_agents:
            sub_agents_item = sub_agents_item_data.to_dict()
            sub_agents.append(sub_agents_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agent": agent,
                "sessionId": session_id,
                "entries": entries,
                "totals": totals,
                "subAgents": sub_agents,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_by_trace_id_transcript_response_200_entries_item import (
            GetApiTracesByTraceIdTranscriptResponse200EntriesItem,
        )
        from ..models.get_api_traces_by_trace_id_transcript_response_200_sub_agents_item import (
            GetApiTracesByTraceIdTranscriptResponse200SubAgentsItem,
        )
        from ..models.get_api_traces_by_trace_id_transcript_response_200_totals import (
            GetApiTracesByTraceIdTranscriptResponse200Totals,
        )

        d = dict(src_dict)
        agent = d.pop("agent")

        def _parse_session_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        session_id = _parse_session_id(d.pop("sessionId"))

        entries = []
        _entries = d.pop("entries")
        for entries_item_data in _entries:
            entries_item = GetApiTracesByTraceIdTranscriptResponse200EntriesItem.from_dict(entries_item_data)

            entries.append(entries_item)

        totals = GetApiTracesByTraceIdTranscriptResponse200Totals.from_dict(d.pop("totals"))

        sub_agents = []
        _sub_agents = d.pop("subAgents")
        for sub_agents_item_data in _sub_agents:
            sub_agents_item = GetApiTracesByTraceIdTranscriptResponse200SubAgentsItem.from_dict(sub_agents_item_data)

            sub_agents.append(sub_agents_item)

        get_api_traces_by_trace_id_transcript_response_200 = cls(
            agent=agent,
            session_id=session_id,
            entries=entries,
            totals=totals,
            sub_agents=sub_agents,
        )

        get_api_traces_by_trace_id_transcript_response_200.additional_properties = d
        return get_api_traces_by_trace_id_transcript_response_200

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
