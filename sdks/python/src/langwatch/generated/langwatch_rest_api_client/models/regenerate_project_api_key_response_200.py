from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RegenerateProjectApiKeyResponse200")


@_attrs_define
class RegenerateProjectApiKeyResponse200:
    """
    Attributes:
        api_key (str):
    """

    api_key: str

    def to_dict(self) -> dict[str, Any]:
        api_key = self.api_key

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "apiKey": api_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        api_key = d.pop("apiKey")

        regenerate_project_api_key_response_200 = cls(
            api_key=api_key,
        )

        return regenerate_project_api_key_response_200
