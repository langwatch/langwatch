from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListCliIngestionSourcesResponse200SourcesItem")


@_attrs_define
class ListCliIngestionSourcesResponse200SourcesItem:
    """
    Attributes:
        id (str):
        name (str):
        source_type (str):
        description (None | str):
        status (str):
        last_event_at (None | str):
        created_at (str):
        archived_at (None | str):
    """

    id: str
    name: str
    source_type: str
    description: None | str
    status: str
    last_event_at: None | str
    created_at: str
    archived_at: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        source_type = self.source_type

        description: None | str
        description = self.description

        status = self.status

        last_event_at: None | str
        last_event_at = self.last_event_at

        created_at = self.created_at

        archived_at: None | str
        archived_at = self.archived_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "sourceType": source_type,
                "description": description,
                "status": status,
                "lastEventAt": last_event_at,
                "createdAt": created_at,
                "archivedAt": archived_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        source_type = d.pop("sourceType")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        status = d.pop("status")

        def _parse_last_event_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_event_at = _parse_last_event_at(d.pop("lastEventAt"))

        created_at = d.pop("createdAt")

        def _parse_archived_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))

        list_cli_ingestion_sources_response_200_sources_item = cls(
            id=id,
            name=name,
            source_type=source_type,
            description=description,
            status=status,
            last_event_at=last_event_at,
            created_at=created_at,
            archived_at=archived_at,
        )

        return list_cli_ingestion_sources_response_200_sources_item
