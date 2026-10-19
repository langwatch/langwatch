from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="ArchiveProjectResponse200")


@_attrs_define
class ArchiveProjectResponse200:
    """
    Attributes:
        id (str):
        name (str):
        archived_at (datetime.datetime):
    """

    id: str
    name: str
    archived_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        archived_at = self.archived_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "archivedAt": archived_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        archived_at = isoparse(d.pop("archivedAt"))

        archive_project_response_200 = cls(
            id=id,
            name=name,
            archived_at=archived_at,
        )

        return archive_project_response_200
