from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiAgentCacheByNameResponse200")


@_attrs_define
class GetApiAgentCacheByNameResponse200:
    """
    Attributes:
        name (str):
        value (str):
    """

    name: str
    value: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        value = d.pop("value")

        get_api_agent_cache_by_name_response_200 = cls(
            name=name,
            value=value,
        )

        return get_api_agent_cache_by_name_response_200
