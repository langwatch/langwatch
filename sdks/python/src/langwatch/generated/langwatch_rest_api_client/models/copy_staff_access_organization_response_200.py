from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.copy_staff_access_organization_response_200_items_item import (
        CopyStaffAccessOrganizationResponse200ItemsItem,
    )
    from ..models.copy_staff_access_organization_response_200_source import CopyStaffAccessOrganizationResponse200Source
    from ..models.copy_staff_access_organization_response_200_target import CopyStaffAccessOrganizationResponse200Target
    from ..models.copy_staff_access_organization_response_200_totals import CopyStaffAccessOrganizationResponse200Totals


T = TypeVar("T", bound="CopyStaffAccessOrganizationResponse200")


@_attrs_define
class CopyStaffAccessOrganizationResponse200:
    """
    Attributes:
        source (CopyStaffAccessOrganizationResponse200Source):
        target (CopyStaffAccessOrganizationResponse200Target):
        dry_run (bool):
        stopped_because (None | str):
        items (list[CopyStaffAccessOrganizationResponse200ItemsItem]):
        totals (CopyStaffAccessOrganizationResponse200Totals):
    """

    source: CopyStaffAccessOrganizationResponse200Source
    target: CopyStaffAccessOrganizationResponse200Target
    dry_run: bool
    stopped_because: None | str
    items: list[CopyStaffAccessOrganizationResponse200ItemsItem]
    totals: CopyStaffAccessOrganizationResponse200Totals

    def to_dict(self) -> dict[str, Any]:
        source = self.source.to_dict()

        target = self.target.to_dict()

        dry_run = self.dry_run

        stopped_because: None | str
        stopped_because = self.stopped_because

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        totals = self.totals.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "source": source,
                "target": target,
                "dryRun": dry_run,
                "stoppedBecause": stopped_because,
                "items": items,
                "totals": totals,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.copy_staff_access_organization_response_200_items_item import (
            CopyStaffAccessOrganizationResponse200ItemsItem,
        )
        from ..models.copy_staff_access_organization_response_200_source import (
            CopyStaffAccessOrganizationResponse200Source,
        )
        from ..models.copy_staff_access_organization_response_200_target import (
            CopyStaffAccessOrganizationResponse200Target,
        )
        from ..models.copy_staff_access_organization_response_200_totals import (
            CopyStaffAccessOrganizationResponse200Totals,
        )

        d = dict(src_dict)
        source = CopyStaffAccessOrganizationResponse200Source.from_dict(d.pop("source"))

        target = CopyStaffAccessOrganizationResponse200Target.from_dict(d.pop("target"))

        dry_run = d.pop("dryRun")

        def _parse_stopped_because(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        stopped_because = _parse_stopped_because(d.pop("stoppedBecause"))

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = CopyStaffAccessOrganizationResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        totals = CopyStaffAccessOrganizationResponse200Totals.from_dict(d.pop("totals"))

        copy_staff_access_organization_response_200 = cls(
            source=source,
            target=target,
            dry_run=dry_run,
            stopped_because=stopped_because,
            items=items,
            totals=totals,
        )

        return copy_staff_access_organization_response_200
