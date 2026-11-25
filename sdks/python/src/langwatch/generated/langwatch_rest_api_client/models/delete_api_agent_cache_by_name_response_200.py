from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteApiAgentCacheByNameResponse200")


@_attrs_define
class DeleteApiAgentCacheByNameResponse200:
    """
    Attributes:
        name (str):
        deleted (bool):
    """

    name: str
    deleted: bool

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        deleted = self.deleted

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "deleted": deleted,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        deleted = d.pop("deleted")

        delete_api_agent_cache_by_name_response_200 = cls(
            name=name,
            deleted=deleted,
        )

        return delete_api_agent_cache_by_name_response_200
