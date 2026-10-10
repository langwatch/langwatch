from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.get_project_response_200_pii_redaction_level import GetProjectResponse200PiiRedactionLevel

T = TypeVar("T", bound="GetProjectResponse200")


@_attrs_define
class GetProjectResponse200:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        language (str):
        framework (str):
        team_id (str):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        pii_redaction_level (GetProjectResponse200PiiRedactionLevel):
    """

    id: str
    name: str
    slug: str
    language: str
    framework: str
    team_id: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    pii_redaction_level: GetProjectResponse200PiiRedactionLevel

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        language = self.language

        framework = self.framework

        team_id = self.team_id

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        pii_redaction_level = self.pii_redaction_level.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "language": language,
                "framework": framework,
                "teamId": team_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "piiRedactionLevel": pii_redaction_level,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        language = d.pop("language")

        framework = d.pop("framework")

        team_id = d.pop("teamId")

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        pii_redaction_level = GetProjectResponse200PiiRedactionLevel(d.pop("piiRedactionLevel"))

        get_project_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
            language=language,
            framework=framework,
            team_id=team_id,
            created_at=created_at,
            updated_at=updated_at,
            pii_redaction_level=pii_redaction_level,
        )

        return get_project_response_200
