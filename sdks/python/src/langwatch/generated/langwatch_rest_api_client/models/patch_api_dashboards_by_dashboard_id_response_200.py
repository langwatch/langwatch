from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.patch_api_dashboards_by_dashboard_id_response_200_scope import (
    PatchApiDashboardsByDashboardIdResponse200Scope,
)

T = TypeVar("T", bound="PatchApiDashboardsByDashboardIdResponse200")


@_attrs_define
class PatchApiDashboardsByDashboardIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        description (None | str):
        scope (PatchApiDashboardsByDashboardIdResponse200Scope):
        excluded_origins (list[str] | None):
        created_by_id (None | str):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    description: None | str
    scope: PatchApiDashboardsByDashboardIdResponse200Scope
    excluded_origins: list[str] | None
    created_by_id: None | str
    created_at: str
    updated_at: str
    platform_url: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        description: None | str
        description = self.description

        scope = self.scope.value

        excluded_origins: list[str] | None
        if isinstance(self.excluded_origins, list):
            excluded_origins = self.excluded_origins

        else:
            excluded_origins = self.excluded_origins

        created_by_id: None | str
        created_by_id = self.created_by_id

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "description": description,
                "scope": scope,
                "excludedOrigins": excluded_origins,
                "createdById": created_by_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        scope = PatchApiDashboardsByDashboardIdResponse200Scope(d.pop("scope"))

        def _parse_excluded_origins(data: object) -> list[str] | None:
            if data is None:
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                excluded_origins_type_0 = cast(list[str], data)

                return excluded_origins_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None, data)

        excluded_origins = _parse_excluded_origins(d.pop("excludedOrigins"))

        def _parse_created_by_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by_id = _parse_created_by_id(d.pop("createdById"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        patch_api_dashboards_by_dashboard_id_response_200 = cls(
            id=id,
            name=name,
            description=description,
            scope=scope,
            excluded_origins=excluded_origins,
            created_by_id=created_by_id,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        return patch_api_dashboards_by_dashboard_id_response_200
