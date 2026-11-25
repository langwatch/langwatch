from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_platform_health_response_200_checks_item_name import GetPlatformHealthResponse200ChecksItemName
from ..models.get_platform_health_response_200_checks_item_status import GetPlatformHealthResponse200ChecksItemStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetPlatformHealthResponse200ChecksItem")


@_attrs_define
class GetPlatformHealthResponse200ChecksItem:
    """
    Attributes:
        name (GetPlatformHealthResponse200ChecksItemName):
        status (GetPlatformHealthResponse200ChecksItemStatus):
        duration_ms (int):
        detail (str | Unset):
    """

    name: GetPlatformHealthResponse200ChecksItemName
    status: GetPlatformHealthResponse200ChecksItemStatus
    duration_ms: int
    detail: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        status = self.status.value

        duration_ms = self.duration_ms

        detail = self.detail

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "status": status,
                "durationMs": duration_ms,
            }
        )
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = GetPlatformHealthResponse200ChecksItemName(d.pop("name"))

        status = GetPlatformHealthResponse200ChecksItemStatus(d.pop("status"))

        duration_ms = d.pop("durationMs")

        detail = d.pop("detail", UNSET)

        get_platform_health_response_200_checks_item = cls(
            name=name,
            status=status,
            duration_ms=duration_ms,
            detail=detail,
        )

        return get_platform_health_response_200_checks_item
