from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EvaluationTimestamps")


@_attrs_define
class EvaluationTimestamps:
    """
    Attributes:
        ignore_timestamps_on_write (bool | None | Unset):
        inserted_at (int | None | Unset):
        started_at (int | None | Unset):
        finished_at (int | None | Unset):
        updated_at (int | None | Unset):
    """

    ignore_timestamps_on_write: bool | None | Unset = UNSET
    inserted_at: int | None | Unset = UNSET
    started_at: int | None | Unset = UNSET
    finished_at: int | None | Unset = UNSET
    updated_at: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ignore_timestamps_on_write: bool | None | Unset
        if isinstance(self.ignore_timestamps_on_write, Unset):
            ignore_timestamps_on_write = UNSET
        else:
            ignore_timestamps_on_write = self.ignore_timestamps_on_write

        inserted_at: int | None | Unset
        if isinstance(self.inserted_at, Unset):
            inserted_at = UNSET
        else:
            inserted_at = self.inserted_at

        started_at: int | None | Unset
        if isinstance(self.started_at, Unset):
            started_at = UNSET
        else:
            started_at = self.started_at

        finished_at: int | None | Unset
        if isinstance(self.finished_at, Unset):
            finished_at = UNSET
        else:
            finished_at = self.finished_at

        updated_at: int | None | Unset
        if isinstance(self.updated_at, Unset):
            updated_at = UNSET
        else:
            updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if ignore_timestamps_on_write is not UNSET:
            field_dict["ignore_timestamps_on_write"] = ignore_timestamps_on_write
        if inserted_at is not UNSET:
            field_dict["inserted_at"] = inserted_at
        if started_at is not UNSET:
            field_dict["started_at"] = started_at
        if finished_at is not UNSET:
            field_dict["finished_at"] = finished_at
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_ignore_timestamps_on_write(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        ignore_timestamps_on_write = _parse_ignore_timestamps_on_write(d.pop("ignore_timestamps_on_write", UNSET))

        def _parse_inserted_at(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        inserted_at = _parse_inserted_at(d.pop("inserted_at", UNSET))

        def _parse_started_at(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        started_at = _parse_started_at(d.pop("started_at", UNSET))

        def _parse_finished_at(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        finished_at = _parse_finished_at(d.pop("finished_at", UNSET))

        def _parse_updated_at(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        updated_at = _parse_updated_at(d.pop("updated_at", UNSET))

        evaluation_timestamps = cls(
            ignore_timestamps_on_write=ignore_timestamps_on_write,
            inserted_at=inserted_at,
            started_at=started_at,
            finished_at=finished_at,
            updated_at=updated_at,
        )

        evaluation_timestamps.additional_properties = d
        return evaluation_timestamps

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
