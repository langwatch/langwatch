from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="TraceEventsItemTimestamps")


@_attrs_define
class TraceEventsItemTimestamps:
    """
    Attributes:
        started_at (float):
        inserted_at (float):
        updated_at (float):
    """

    started_at: float
    inserted_at: float
    updated_at: float

    def to_dict(self) -> dict[str, Any]:
        started_at = self.started_at

        inserted_at = self.inserted_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "started_at": started_at,
                "inserted_at": inserted_at,
                "updated_at": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        started_at = d.pop("started_at")

        inserted_at = d.pop("inserted_at")

        updated_at = d.pop("updated_at")

        trace_events_item_timestamps = cls(
            started_at=started_at,
            inserted_at=inserted_at,
            updated_at=updated_at,
        )

        return trace_events_item_timestamps
