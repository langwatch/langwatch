from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.read_cli_ingestion_source_health_response_200_health import (
        ReadCliIngestionSourceHealthResponse200Health,
    )
    from ..models.read_cli_ingestion_source_health_response_200_source import (
        ReadCliIngestionSourceHealthResponse200Source,
    )


T = TypeVar("T", bound="ReadCliIngestionSourceHealthResponse200")


@_attrs_define
class ReadCliIngestionSourceHealthResponse200:
    """
    Attributes:
        source (ReadCliIngestionSourceHealthResponse200Source):
        health (ReadCliIngestionSourceHealthResponse200Health):
    """

    source: ReadCliIngestionSourceHealthResponse200Source
    health: ReadCliIngestionSourceHealthResponse200Health

    def to_dict(self) -> dict[str, Any]:
        source = self.source.to_dict()

        health = self.health.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "source": source,
                "health": health,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_ingestion_source_health_response_200_health import (
            ReadCliIngestionSourceHealthResponse200Health,
        )
        from ..models.read_cli_ingestion_source_health_response_200_source import (
            ReadCliIngestionSourceHealthResponse200Source,
        )

        d = dict(src_dict)
        source = ReadCliIngestionSourceHealthResponse200Source.from_dict(d.pop("source"))

        health = ReadCliIngestionSourceHealthResponse200Health.from_dict(d.pop("health"))

        read_cli_ingestion_source_health_response_200 = cls(
            source=source,
            health=health,
        )

        return read_cli_ingestion_source_health_response_200
