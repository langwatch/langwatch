from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="CopyStaffAccessOrganizationResponse200Totals")


@_attrs_define
class CopyStaffAccessOrganizationResponse200Totals:
    """
    Attributes:
        planned (int):
        copied (int):
        already_copied (int):
        skipped (int):
        failed (int):
        stopped (int):
    """

    planned: int
    copied: int
    already_copied: int
    skipped: int
    failed: int
    stopped: int
    additional_properties: dict[str, int] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        planned = self.planned

        copied = self.copied

        already_copied = self.already_copied

        skipped = self.skipped

        failed = self.failed

        stopped = self.stopped

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "planned": planned,
                "copied": copied,
                "already_copied": already_copied,
                "skipped": skipped,
                "failed": failed,
                "stopped": stopped,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        planned = d.pop("planned")

        copied = d.pop("copied")

        already_copied = d.pop("already_copied")

        skipped = d.pop("skipped")

        failed = d.pop("failed")

        stopped = d.pop("stopped")

        copy_staff_access_organization_response_200_totals = cls(
            planned=planned,
            copied=copied,
            already_copied=already_copied,
            skipped=skipped,
            failed=failed,
            stopped=stopped,
        )

        copy_staff_access_organization_response_200_totals.additional_properties = d
        return copy_staff_access_organization_response_200_totals

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> int:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: int) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
