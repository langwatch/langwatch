from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReplaceAgentResponse200OwnerType0")


@_attrs_define
class ReplaceAgentResponse200OwnerType0:
    """
    Attributes:
        user_id (str):
        name (None | str):
    """

    user_id: str
    name: None | str

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        name: None | str
        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "userId": user_id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_id = d.pop("userId")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        replace_agent_response_200_owner_type_0 = cls(
            user_id=user_id,
            name=name,
        )

        return replace_agent_response_200_owner_type_0
