from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_platform_health_response_503_status import GetPlatformHealthResponse503Status

if TYPE_CHECKING:
    from ..models.get_platform_health_response_503_checks_item import GetPlatformHealthResponse503ChecksItem


T = TypeVar("T", bound="GetPlatformHealthResponse503")


@_attrs_define
class GetPlatformHealthResponse503:
    """
    Attributes:
        status (GetPlatformHealthResponse503Status):
        checked_at (str):
        checks (list[GetPlatformHealthResponse503ChecksItem]):
    """

    status: GetPlatformHealthResponse503Status
    checked_at: str
    checks: list[GetPlatformHealthResponse503ChecksItem]

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        checked_at = self.checked_at

        checks = []
        for checks_item_data in self.checks:
            checks_item = checks_item_data.to_dict()
            checks.append(checks_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "checkedAt": checked_at,
                "checks": checks,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_platform_health_response_503_checks_item import GetPlatformHealthResponse503ChecksItem

        d = dict(src_dict)
        status = GetPlatformHealthResponse503Status(d.pop("status"))

        checked_at = d.pop("checkedAt")

        checks = []
        _checks = d.pop("checks")
        for checks_item_data in _checks:
            checks_item = GetPlatformHealthResponse503ChecksItem.from_dict(checks_item_data)

            checks.append(checks_item)

        get_platform_health_response_503 = cls(
            status=status,
            checked_at=checked_at,
            checks=checks,
        )

        return get_platform_health_response_503
