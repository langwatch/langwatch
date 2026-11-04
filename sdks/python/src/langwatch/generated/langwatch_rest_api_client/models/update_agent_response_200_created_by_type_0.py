from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="UpdateAgentResponse200CreatedByType0")


@_attrs_define
class UpdateAgentResponse200CreatedByType0:
    """
    Attributes:
        id (str):
        name (None | str):
    """

    id: str
    name: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name: None | str
        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        update_agent_response_200_created_by_type_0 = cls(
            id=id,
            name=name,
        )

        return update_agent_response_200_created_by_type_0
