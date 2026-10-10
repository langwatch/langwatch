from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_checkup_response_200_usage_report_payload import GetApiCheckupResponse200UsageReportPayload
    from ..models.get_api_checkup_response_200_usage_report_switches import GetApiCheckupResponse200UsageReportSwitches


T = TypeVar("T", bound="GetApiCheckupResponse200UsageReport")


@_attrs_define
class GetApiCheckupResponse200UsageReport:
    """
    Attributes:
        payload (GetApiCheckupResponse200UsageReportPayload):
        schema_version (int):
        switches (GetApiCheckupResponse200UsageReportSwitches | Unset):
        endpoint (str | Unset):
        disabled (bool | Unset):
        next_report_at (None | str | Unset):
    """

    payload: GetApiCheckupResponse200UsageReportPayload
    schema_version: int
    switches: GetApiCheckupResponse200UsageReportSwitches | Unset = UNSET
    endpoint: str | Unset = UNSET
    disabled: bool | Unset = UNSET
    next_report_at: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        payload = self.payload.to_dict()

        schema_version = self.schema_version

        switches: dict[str, Any] | Unset = UNSET
        if not isinstance(self.switches, Unset):
            switches = self.switches.to_dict()

        endpoint = self.endpoint

        disabled = self.disabled

        next_report_at: None | str | Unset
        if isinstance(self.next_report_at, Unset):
            next_report_at = UNSET
        else:
            next_report_at = self.next_report_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "payload": payload,
                "schemaVersion": schema_version,
            }
        )
        if switches is not UNSET:
            field_dict["switches"] = switches
        if endpoint is not UNSET:
            field_dict["endpoint"] = endpoint
        if disabled is not UNSET:
            field_dict["disabled"] = disabled
        if next_report_at is not UNSET:
            field_dict["nextReportAt"] = next_report_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_checkup_response_200_usage_report_payload import (
            GetApiCheckupResponse200UsageReportPayload,
        )
        from ..models.get_api_checkup_response_200_usage_report_switches import (
            GetApiCheckupResponse200UsageReportSwitches,
        )

        d = dict(src_dict)
        payload = GetApiCheckupResponse200UsageReportPayload.from_dict(d.pop("payload"))

        schema_version = d.pop("schemaVersion")

        _switches = d.pop("switches", UNSET)
        switches: GetApiCheckupResponse200UsageReportSwitches | Unset
        if isinstance(_switches, Unset):
            switches = UNSET
        else:
            switches = GetApiCheckupResponse200UsageReportSwitches.from_dict(_switches)

        endpoint = d.pop("endpoint", UNSET)

        disabled = d.pop("disabled", UNSET)

        def _parse_next_report_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        next_report_at = _parse_next_report_at(d.pop("nextReportAt", UNSET))

        get_api_checkup_response_200_usage_report = cls(
            payload=payload,
            schema_version=schema_version,
            switches=switches,
            endpoint=endpoint,
            disabled=disabled,
            next_report_at=next_report_at,
        )

        return get_api_checkup_response_200_usage_report
