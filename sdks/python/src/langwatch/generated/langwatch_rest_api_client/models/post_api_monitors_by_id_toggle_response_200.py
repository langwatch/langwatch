from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiMonitorsByIdToggleResponse200")


@_attrs_define
class PostApiMonitorsByIdToggleResponse200:
    """
    Attributes:
        id (str):
        enabled (bool):
    """

    id: str
    enabled: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        enabled = self.enabled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "enabled": enabled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        enabled = d.pop("enabled")

        post_api_monitors_by_id_toggle_response_200 = cls(
            id=id,
            enabled=enabled,
        )

        return post_api_monitors_by_id_toggle_response_200
