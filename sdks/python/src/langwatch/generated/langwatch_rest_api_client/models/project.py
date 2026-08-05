from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.project_pii_redaction_level import ProjectPiiRedactionLevel
from ..types import UNSET, Unset

T = TypeVar("T", bound="Project")


@_attrs_define
class Project:
    """
    Attributes:
        id (str | Unset): Project ID (project_...)
        name (str | Unset):
        slug (str | Unset):
        language (str | Unset):
        framework (str | Unset):
        team_id (str | Unset):
        pii_redaction_level (ProjectPiiRedactionLevel | Unset):
        created_at (datetime.datetime | Unset):
        updated_at (datetime.datetime | Unset):
    """

    id: str | Unset = UNSET
    name: str | Unset = UNSET
    slug: str | Unset = UNSET
    language: str | Unset = UNSET
    framework: str | Unset = UNSET
    team_id: str | Unset = UNSET
    pii_redaction_level: ProjectPiiRedactionLevel | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    updated_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        language = self.language

        framework = self.framework

        team_id = self.team_id

        pii_redaction_level: str | Unset = UNSET
        if not isinstance(self.pii_redaction_level, Unset):
            pii_redaction_level = self.pii_redaction_level.value

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        updated_at: str | Unset = UNSET
        if not isinstance(self.updated_at, Unset):
            updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if slug is not UNSET:
            field_dict["slug"] = slug
        if language is not UNSET:
            field_dict["language"] = language
        if framework is not UNSET:
            field_dict["framework"] = framework
        if team_id is not UNSET:
            field_dict["teamId"] = team_id
        if pii_redaction_level is not UNSET:
            field_dict["piiRedactionLevel"] = pii_redaction_level
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        slug = d.pop("slug", UNSET)

        language = d.pop("language", UNSET)

        framework = d.pop("framework", UNSET)

        team_id = d.pop("teamId", UNSET)

        _pii_redaction_level = d.pop("piiRedactionLevel", UNSET)
        pii_redaction_level: ProjectPiiRedactionLevel | Unset
        if isinstance(_pii_redaction_level, Unset):
            pii_redaction_level = UNSET
        else:
            pii_redaction_level = ProjectPiiRedactionLevel(_pii_redaction_level)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)

        _updated_at = d.pop("updatedAt", UNSET)
        updated_at: datetime.datetime | Unset
        if isinstance(_updated_at, Unset):
            updated_at = UNSET
        else:
            updated_at = isoparse(_updated_at)

        project = cls(
            id=id,
            name=name,
            slug=slug,
            language=language,
            framework=framework,
            team_id=team_id,
            pii_redaction_level=pii_redaction_level,
            created_at=created_at,
            updated_at=updated_at,
        )

        project.additional_properties = d
        return project

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
