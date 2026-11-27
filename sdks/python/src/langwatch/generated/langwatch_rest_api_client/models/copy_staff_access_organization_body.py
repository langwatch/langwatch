from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="CopyStaffAccessOrganizationBody")


@_attrs_define
class CopyStaffAccessOrganizationBody:
    """
    Attributes:
        source_ops_token (str):
        projects (list[str] | Unset):
        dry_run (bool | Unset):
    """

    source_ops_token: str
    projects: list[str] | Unset = UNSET
    dry_run: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        source_ops_token = self.source_ops_token

        projects: list[str] | Unset = UNSET
        if not isinstance(self.projects, Unset):
            projects = self.projects

        dry_run = self.dry_run

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sourceOpsToken": source_ops_token,
            }
        )
        if projects is not UNSET:
            field_dict["projects"] = projects
        if dry_run is not UNSET:
            field_dict["dryRun"] = dry_run

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        source_ops_token = d.pop("sourceOpsToken")

        projects = cast(list[str], d.pop("projects", UNSET))

        dry_run = d.pop("dryRun", UNSET)

        copy_staff_access_organization_body = cls(
            source_ops_token=source_ops_token,
            projects=projects,
            dry_run=dry_run,
        )

        return copy_staff_access_organization_body
