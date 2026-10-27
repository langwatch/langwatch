from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="CreateScimTokenResponse201")


@_attrs_define
class CreateScimTokenResponse201:
    """
    Attributes:
        id (str):
        token (str):
        connection_id (str):
        description (None | str):
    """

    id: str
    token: str
    connection_id: str
    description: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        token = self.token

        connection_id = self.connection_id

        description: None | str
        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "token": token,
                "connectionId": connection_id,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        token = d.pop("token")

        connection_id = d.pop("connectionId")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        create_scim_token_response_201 = cls(
            id=id,
            token=token,
            connection_id=connection_id,
            description=description,
        )

        return create_scim_token_response_201
