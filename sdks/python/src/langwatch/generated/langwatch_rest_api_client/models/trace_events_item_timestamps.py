from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="TraceEventsItemTimestamps")


@_attrs_define
class TraceEventsItemTimestamps:
    """
    Attributes:
        started_at (int):
        inserted_at (int):
        updated_at (int):
    """

    started_at: int
    inserted_at: int
    updated_at: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        started_at = self.started_at

        inserted_at = self.inserted_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        trace_events_item_timestamps.additional_properties = d
        return trace_events_item_timestamps

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
