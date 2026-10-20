from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_200_scope import (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200Scope,
)

T = TypeVar("T", bound="DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200")


@_attrs_define
class DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        description (None | str):
        scope (DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200Scope):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    description: None | str
    scope: DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200Scope
    created_at: str
    updated_at: str
    platform_url: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        description: None | str
        description = self.description

        scope = self.scope.value

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

        scope = DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200Scope(d.pop("scope"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_200 = cls(
            id=id,
            name=name,
            description=description,
            scope=scope,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        return delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_200
