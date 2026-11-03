from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetStaffAccessOrganizationUsageResponse200Gateway")


@_attrs_define
class GetStaffAccessOrganizationUsageResponse200Gateway:
    """
    Attributes:
        requests_30_days (int):
        spend_usd_30_days (float):
    """

    requests_30_days: int
    spend_usd_30_days: float

    def to_dict(self) -> dict[str, Any]:
        requests_30_days = self.requests_30_days

        spend_usd_30_days = self.spend_usd_30_days

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "requests30Days": requests_30_days,
                "spendUsd30Days": spend_usd_30_days,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        requests_30_days = d.pop("requests30Days")

        spend_usd_30_days = d.pop("spendUsd30Days")

        get_staff_access_organization_usage_response_200_gateway = cls(
            requests_30_days=requests_30_days,
            spend_usd_30_days=spend_usd_30_days,
        )

        return get_staff_access_organization_usage_response_200_gateway
