from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="CreateSecretResponse201")


@_attrs_define
class CreateSecretResponse201:
    """
    Attributes:
        id (str):
        project_id (str):
        name (str):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: str
    project_id: str
    name: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        name = self.name

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "projectId": project_id,
                "name": name,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        name = d.pop("name")

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        create_secret_response_201 = cls(
            id=id,
            project_id=project_id,
            name=name,
            created_at=created_at,
            updated_at=updated_at,
        )

        return create_secret_response_201
