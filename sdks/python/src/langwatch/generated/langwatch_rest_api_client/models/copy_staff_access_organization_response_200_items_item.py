from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.copy_staff_access_organization_response_200_items_item_kind import (
    CopyStaffAccessOrganizationResponse200ItemsItemKind,
)
from ..models.copy_staff_access_organization_response_200_items_item_outcome import (
    CopyStaffAccessOrganizationResponse200ItemsItemOutcome,
)

T = TypeVar("T", bound="CopyStaffAccessOrganizationResponse200ItemsItem")


@_attrs_define
class CopyStaffAccessOrganizationResponse200ItemsItem:
    """
    Attributes:
        kind (CopyStaffAccessOrganizationResponse200ItemsItemKind):
        name (str):
        source_id (str):
        source_project_id (str):
        outcome (CopyStaffAccessOrganizationResponse200ItemsItemOutcome):
        target_id (None | str):
        target_project_id (None | str):
        reason (None | str):
    """

    kind: CopyStaffAccessOrganizationResponse200ItemsItemKind
    name: str
    source_id: str
    source_project_id: str
    outcome: CopyStaffAccessOrganizationResponse200ItemsItemOutcome
    target_id: None | str
    target_project_id: None | str
    reason: None | str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind.value

        name = self.name

        source_id = self.source_id

        source_project_id = self.source_project_id

        outcome = self.outcome.value

        target_id: None | str
        target_id = self.target_id

        target_project_id: None | str
        target_project_id = self.target_project_id

        reason: None | str
        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "name": name,
                "sourceId": source_id,
                "sourceProjectId": source_project_id,
                "outcome": outcome,
                "targetId": target_id,
                "targetProjectId": target_project_id,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = CopyStaffAccessOrganizationResponse200ItemsItemKind(d.pop("kind"))

        name = d.pop("name")

        source_id = d.pop("sourceId")

        source_project_id = d.pop("sourceProjectId")

        outcome = CopyStaffAccessOrganizationResponse200ItemsItemOutcome(d.pop("outcome"))

        def _parse_target_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        target_id = _parse_target_id(d.pop("targetId"))

        def _parse_target_project_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        target_project_id = _parse_target_project_id(d.pop("targetProjectId"))

        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))

        copy_staff_access_organization_response_200_items_item = cls(
            kind=kind,
            name=name,
            source_id=source_id,
            source_project_id=source_project_id,
            outcome=outcome,
            target_id=target_id,
            target_project_id=target_project_id,
            reason=reason,
        )

        return copy_staff_access_organization_response_200_items_item
