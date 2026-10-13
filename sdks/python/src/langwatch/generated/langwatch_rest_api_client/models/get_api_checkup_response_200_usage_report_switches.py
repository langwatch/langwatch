from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiCheckupResponse200UsageReportSwitches")


@_attrs_define
class GetApiCheckupResponse200UsageReportSwitches:
    """
    Attributes:
        optional (bool):
        hostname (bool):
    """

    optional: bool
    hostname: bool

    def to_dict(self) -> dict[str, Any]:
        optional = self.optional

        hostname = self.hostname

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "optional": optional,
                "hostname": hostname,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        optional = d.pop("optional")

        hostname = d.pop("hostname")

        get_api_checkup_response_200_usage_report_switches = cls(
            optional=optional,
            hostname=hostname,
        )

        return get_api_checkup_response_200_usage_report_switches
