from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.project_pii_redaction_level import ProjectPiiRedactionLevel
from ..types import UNSET, Unset

T = TypeVar("T", bound="Project")


@_attrs_define
class Project:
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
        pii_redaction_level (ProjectPiiRedactionLevel | Unset):
    """

    id: str
    name: str
    slug: str
    language: str
    framework: str
    team_id: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    pii_redaction_level: ProjectPiiRedactionLevel | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        language = self.language

        framework = self.framework

        team_id = self.team_id

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        pii_redaction_level: str | Unset = UNSET
        if not isinstance(self.pii_redaction_level, Unset):
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
            }
        )
        if pii_redaction_level is not UNSET:
            field_dict["piiRedactionLevel"] = pii_redaction_level

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

        _pii_redaction_level = d.pop("piiRedactionLevel", UNSET)
        pii_redaction_level: ProjectPiiRedactionLevel | Unset
        if isinstance(_pii_redaction_level, Unset):
            pii_redaction_level = UNSET
        else:
            pii_redaction_level = ProjectPiiRedactionLevel(_pii_redaction_level)

        project = cls(
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

        return project
