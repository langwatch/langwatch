from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="CreateProjectResponse201")


@_attrs_define
class CreateProjectResponse201:
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
        service_api_key (str):
        service_api_key_id (str):
    """

    id: str
    name: str
    slug: str
    language: str
    framework: str
    team_id: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    service_api_key: str
    service_api_key_id: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        language = self.language

        framework = self.framework

        team_id = self.team_id

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        service_api_key = self.service_api_key

        service_api_key_id = self.service_api_key_id

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
                "serviceApiKey": service_api_key,
                "serviceApiKeyId": service_api_key_id,
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

        service_api_key = d.pop("serviceApiKey")

        service_api_key_id = d.pop("serviceApiKeyId")

        create_project_response_201 = cls(
            id=id,
            name=name,
            slug=slug,
            language=language,
            framework=framework,
            team_id=team_id,
            created_at=created_at,
            updated_at=updated_at,
            service_api_key=service_api_key,
            service_api_key_id=service_api_key_id,
        )

        return create_project_response_201
