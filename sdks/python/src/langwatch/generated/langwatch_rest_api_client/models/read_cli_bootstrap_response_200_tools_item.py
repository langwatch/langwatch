from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliBootstrapResponse200ToolsItem")


@_attrs_define
class ReadCliBootstrapResponse200ToolsItem:
    """
    Attributes:
        slug (str):
        display_name (str):
    """

    slug: str
    display_name: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        display_name = self.display_name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "displayName": display_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        slug = d.pop("slug")

        display_name = d.pop("displayName")

        read_cli_bootstrap_response_200_tools_item = cls(
            slug=slug,
            display_name=display_name,
        )

        return read_cli_bootstrap_response_200_tools_item
