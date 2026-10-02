from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliIngestionSourceHealthResponse200Health")


@_attrs_define
class ReadCliIngestionSourceHealthResponse200Health:
    """
    Attributes:
        events24h (int):
        events7d (int):
        events30d (int):
        last_success_iso (None | str):
    """

    events24h: int
    events7d: int
    events30d: int
    last_success_iso: None | str

    def to_dict(self) -> dict[str, Any]:
        events24h = self.events24h

        events7d = self.events7d

        events30d = self.events30d

        last_success_iso: None | str
        last_success_iso = self.last_success_iso

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "events24h": events24h,
                "events7d": events7d,
                "events30d": events30d,
                "lastSuccessIso": last_success_iso,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        events24h = d.pop("events24h")

        events7d = d.pop("events7d")

        events30d = d.pop("events30d")

        def _parse_last_success_iso(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_success_iso = _parse_last_success_iso(d.pop("lastSuccessIso"))

        read_cli_ingestion_source_health_response_200_health = cls(
            events24h=events24h,
            events7d=events7d,
            events30d=events30d,
            last_success_iso=last_success_iso,
        )

        return read_cli_ingestion_source_health_response_200_health
