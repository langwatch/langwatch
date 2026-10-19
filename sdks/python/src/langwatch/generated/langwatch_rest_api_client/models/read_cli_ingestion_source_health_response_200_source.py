from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliIngestionSourceHealthResponse200Source")


@_attrs_define
class ReadCliIngestionSourceHealthResponse200Source:
    """
    Attributes:
        id (str):
        name (str):
        status (str):
    """

    id: str
    name: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        status = d.pop("status")

        read_cli_ingestion_source_health_response_200_source = cls(
            id=id,
            name=name,
            status=status,
        )

        return read_cli_ingestion_source_health_response_200_source
