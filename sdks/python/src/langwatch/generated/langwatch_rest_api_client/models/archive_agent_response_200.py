from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.archive_agent_response_200_type import ArchiveAgentResponse200Type

T = TypeVar("T", bound="ArchiveAgentResponse200")


@_attrs_define
class ArchiveAgentResponse200:
    """
    Attributes:
        id (str):
        name (str):
        type_ (ArchiveAgentResponse200Type):
        archived_at (datetime.datetime | None):
    """

    id: str
    name: str
    type_: ArchiveAgentResponse200Type
    archived_at: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        type_ = self.type_.value

        archived_at: None | str
        if isinstance(self.archived_at, datetime.datetime):
            archived_at = self.archived_at.isoformat()
        else:
            archived_at = self.archived_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "type": type_,
                "archivedAt": archived_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        type_ = ArchiveAgentResponse200Type(d.pop("type"))

        def _parse_archived_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                archived_at_type_0 = isoparse(data)

                return archived_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))

        archive_agent_response_200 = cls(
            id=id,
            name=name,
            type_=type_,
            archived_at=archived_at,
        )

        return archive_agent_response_200
