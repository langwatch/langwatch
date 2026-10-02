from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliBootstrapResponse200ProvidersItem")


@_attrs_define
class ReadCliBootstrapResponse200ProvidersItem:
    """
    Attributes:
        name (str):
        display_name (str):
        configured (bool):
    """

    name: str
    display_name: str
    configured: bool

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        display_name = self.display_name

        configured = self.configured

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "displayName": display_name,
                "configured": configured,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        display_name = d.pop("displayName")

        configured = d.pop("configured")

        read_cli_bootstrap_response_200_providers_item = cls(
            name=name,
            display_name=display_name,
            configured=configured,
        )

        return read_cli_bootstrap_response_200_providers_item
