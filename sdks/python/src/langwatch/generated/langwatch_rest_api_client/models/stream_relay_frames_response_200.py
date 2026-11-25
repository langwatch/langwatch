from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="StreamRelayFramesResponse200")


@_attrs_define
class StreamRelayFramesResponse200:
    """
    Attributes:
        applied (int):
        duplicate (int):
        rejected (int):
        terminal (bool):
    """

    applied: int
    duplicate: int
    rejected: int
    terminal: bool

    def to_dict(self) -> dict[str, Any]:
        applied = self.applied

        duplicate = self.duplicate

        rejected = self.rejected

        terminal = self.terminal

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "applied": applied,
                "duplicate": duplicate,
                "rejected": rejected,
                "terminal": terminal,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        applied = d.pop("applied")

        duplicate = d.pop("duplicate")

        rejected = d.pop("rejected")

        terminal = d.pop("terminal")

        stream_relay_frames_response_200 = cls(
            applied=applied,
            duplicate=duplicate,
            rejected=rejected,
            terminal=terminal,
        )

        return stream_relay_frames_response_200
