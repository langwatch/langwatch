from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="ListScimTokensResponse200TokensItem")


@_attrs_define
class ListScimTokensResponse200TokensItem:
    """
    Attributes:
        id (str):
        description (None | str):
        connection_id (None | str):
        created_at (datetime.datetime):
        last_used_at (datetime.datetime | None):
    """

    id: str
    description: None | str
    connection_id: None | str
    created_at: datetime.datetime
    last_used_at: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        description: None | str
        description = self.description

        connection_id: None | str
        connection_id = self.connection_id

        created_at = self.created_at.isoformat()

        last_used_at: None | str
        if isinstance(self.last_used_at, datetime.datetime):
            last_used_at = self.last_used_at.isoformat()
        else:
            last_used_at = self.last_used_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "description": description,
                "connectionId": connection_id,
                "createdAt": created_at,
                "lastUsedAt": last_used_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        def _parse_connection_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        connection_id = _parse_connection_id(d.pop("connectionId"))

        created_at = isoparse(d.pop("createdAt"))

        def _parse_last_used_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_used_at_type_0 = isoparse(data)

                return last_used_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_used_at = _parse_last_used_at(d.pop("lastUsedAt"))

        list_scim_tokens_response_200_tokens_item = cls(
            id=id,
            description=description,
            connection_id=connection_id,
            created_at=created_at,
            last_used_at=last_used_at,
        )

        return list_scim_tokens_response_200_tokens_item
