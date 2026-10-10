from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="DeleteStoredObjectResponse200")


@_attrs_define
class DeleteStoredObjectResponse200:
    """
    Attributes:
        id (str):
        generation (int):
        deleted_at (datetime.datetime):
    """

    id: str
    generation: int
    deleted_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        generation = self.generation

        deleted_at = self.deleted_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "generation": generation,
                "deletedAt": deleted_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        generation = d.pop("generation")

        deleted_at = isoparse(d.pop("deletedAt"))

        delete_stored_object_response_200 = cls(
            id=id,
            generation=generation,
            deleted_at=deleted_at,
        )

        return delete_stored_object_response_200
