from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTracesSettleSettingsResponse200")


@_attrs_define
class GetApiTracesSettleSettingsResponse200:
    """
    Attributes:
        wait_timeout_ms (int):
        wait_extension_ms (int):
        quiet_period_ms (int):
    """

    wait_timeout_ms: int
    wait_extension_ms: int
    quiet_period_ms: int

    def to_dict(self) -> dict[str, Any]:
        wait_timeout_ms = self.wait_timeout_ms

        wait_extension_ms = self.wait_extension_ms

        quiet_period_ms = self.quiet_period_ms

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "waitTimeoutMs": wait_timeout_ms,
                "waitExtensionMs": wait_extension_ms,
                "quietPeriodMs": quiet_period_ms,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        wait_timeout_ms = d.pop("waitTimeoutMs")

        wait_extension_ms = d.pop("waitExtensionMs")

        quiet_period_ms = d.pop("quietPeriodMs")

        get_api_traces_settle_settings_response_200 = cls(
            wait_timeout_ms=wait_timeout_ms,
            wait_extension_ms=wait_extension_ms,
            quiet_period_ms=quiet_period_ms,
        )

        return get_api_traces_settle_settings_response_200
