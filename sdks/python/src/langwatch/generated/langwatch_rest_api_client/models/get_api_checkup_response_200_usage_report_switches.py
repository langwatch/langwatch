from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiCheckupResponse200UsageReportSwitches")


@_attrs_define
class GetApiCheckupResponse200UsageReportSwitches:
    """
    Attributes:
        optional (bool):
        hostname (bool):
        upgrade_diagnostics (bool | Unset):
    """

    optional: bool
    hostname: bool
    upgrade_diagnostics: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        optional = self.optional

        hostname = self.hostname

        upgrade_diagnostics = self.upgrade_diagnostics

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "optional": optional,
                "hostname": hostname,
            }
        )
        if upgrade_diagnostics is not UNSET:
            field_dict["upgradeDiagnostics"] = upgrade_diagnostics

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        optional = d.pop("optional")

        hostname = d.pop("hostname")

        upgrade_diagnostics = d.pop("upgradeDiagnostics", UNSET)

        get_api_checkup_response_200_usage_report_switches = cls(
            optional=optional,
            hostname=hostname,
            upgrade_diagnostics=upgrade_diagnostics,
        )

        return get_api_checkup_response_200_usage_report_switches
