from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListCliIngestionSourceEventsResponse200EventsItem")


@_attrs_define
class ListCliIngestionSourceEventsResponse200EventsItem:
    """
    Attributes:
        event_id (str):
        event_type (str):
        actor (str):
        action (str):
        target (str):
        cost_usd (str):
        tokens_input (int):
        tokens_output (int):
        event_timestamp_iso (str):
        ingested_at_iso (str):
        raw_payload (str):
    """

    event_id: str
    event_type: str
    actor: str
    action: str
    target: str
    cost_usd: str
    tokens_input: int
    tokens_output: int
    event_timestamp_iso: str
    ingested_at_iso: str
    raw_payload: str

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        event_type = self.event_type

        actor = self.actor

        action = self.action

        target = self.target

        cost_usd = self.cost_usd

        tokens_input = self.tokens_input

        tokens_output = self.tokens_output

        event_timestamp_iso = self.event_timestamp_iso

        ingested_at_iso = self.ingested_at_iso

        raw_payload = self.raw_payload

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "eventId": event_id,
                "eventType": event_type,
                "actor": actor,
                "action": action,
                "target": target,
                "costUsd": cost_usd,
                "tokensInput": tokens_input,
                "tokensOutput": tokens_output,
                "eventTimestampIso": event_timestamp_iso,
                "ingestedAtIso": ingested_at_iso,
                "rawPayload": raw_payload,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        event_id = d.pop("eventId")

        event_type = d.pop("eventType")

        actor = d.pop("actor")

        action = d.pop("action")

        target = d.pop("target")

        cost_usd = d.pop("costUsd")

        tokens_input = d.pop("tokensInput")

        tokens_output = d.pop("tokensOutput")

        event_timestamp_iso = d.pop("eventTimestampIso")

        ingested_at_iso = d.pop("ingestedAtIso")

        raw_payload = d.pop("rawPayload")

        list_cli_ingestion_source_events_response_200_events_item = cls(
            event_id=event_id,
            event_type=event_type,
            actor=actor,
            action=action,
            target=target,
            cost_usd=cost_usd,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            event_timestamp_iso=event_timestamp_iso,
            ingested_at_iso=ingested_at_iso,
            raw_payload=raw_payload,
        )

        return list_cli_ingestion_source_events_response_200_events_item
