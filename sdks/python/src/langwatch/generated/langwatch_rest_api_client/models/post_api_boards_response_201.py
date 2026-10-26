from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_boards_response_201_scope import PostApiBoardsResponse201Scope

T = TypeVar("T", bound="PostApiBoardsResponse201")


@_attrs_define
class PostApiBoardsResponse201:
    """
    Attributes:
        id (str):
        name (str):
        description (None | str):
        scope (PostApiBoardsResponse201Scope):
        created_by_id (None | str):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    description: None | str
    scope: PostApiBoardsResponse201Scope
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

        scope = PostApiBoardsResponse201Scope(d.pop("scope"))

        def _parse_created_by_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by_id = _parse_created_by_id(d.pop("createdById"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        post_api_boards_response_201 = cls(
            id=id,
            name=name,
            description=description,
            scope=scope,
            created_by_id=created_by_id,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        return post_api_boards_response_201
