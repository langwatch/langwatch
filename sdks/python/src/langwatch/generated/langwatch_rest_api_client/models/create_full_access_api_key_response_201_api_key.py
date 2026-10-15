from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="CreateFullAccessApiKeyResponse201ApiKey")


@_attrs_define
class CreateFullAccessApiKeyResponse201ApiKey:
    """
    Attributes:
        id (str):
        name (str):
        created_at (datetime.datetime):
    """

    id: str
    name: str
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        created_at = isoparse(d.pop("createdAt"))

        create_full_access_api_key_response_201_api_key = cls(
            id=id,
            name=name,
            created_at=created_at,
        )

        return create_full_access_api_key_response_201_api_key
