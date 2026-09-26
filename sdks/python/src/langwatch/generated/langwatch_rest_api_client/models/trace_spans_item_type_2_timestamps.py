from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="TraceSpansItemType2Timestamps")


@_attrs_define
class TraceSpansItemType2Timestamps:
    """
    Attributes:
        started_at (int):
        finished_at (int):
        ignore_timestamps_on_write (bool | None | Unset):
        first_token_at (int | None | Unset):
    """

    started_at: int
    finished_at: int
    ignore_timestamps_on_write: bool | None | Unset = UNSET
    first_token_at: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        started_at = self.started_at

        finished_at = self.finished_at

        ignore_timestamps_on_write: bool | None | Unset
        if isinstance(self.ignore_timestamps_on_write, Unset):
            ignore_timestamps_on_write = UNSET
        else:
            ignore_timestamps_on_write = self.ignore_timestamps_on_write

        first_token_at: int | None | Unset
        if isinstance(self.first_token_at, Unset):
            first_token_at = UNSET
        else:
            first_token_at = self.first_token_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "started_at": started_at,
                "finished_at": finished_at,
            }
        )
        if ignore_timestamps_on_write is not UNSET:
            field_dict["ignore_timestamps_on_write"] = ignore_timestamps_on_write
        if first_token_at is not UNSET:
            field_dict["first_token_at"] = first_token_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        started_at = d.pop("started_at")

        finished_at = d.pop("finished_at")

        def _parse_ignore_timestamps_on_write(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        ignore_timestamps_on_write = _parse_ignore_timestamps_on_write(d.pop("ignore_timestamps_on_write", UNSET))

        def _parse_first_token_at(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        first_token_at = _parse_first_token_at(d.pop("first_token_at", UNSET))

        trace_spans_item_type_2_timestamps = cls(
            started_at=started_at,
            finished_at=finished_at,
            ignore_timestamps_on_write=ignore_timestamps_on_write,
            first_token_at=first_token_at,
        )

        trace_spans_item_type_2_timestamps.additional_properties = d
        return trace_spans_item_type_2_timestamps

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
