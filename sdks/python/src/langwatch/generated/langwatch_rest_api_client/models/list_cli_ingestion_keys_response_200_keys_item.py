from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListCliIngestionKeysResponse200KeysItem")


@_attrs_define
class ListCliIngestionKeysResponse200KeysItem:
    """
    Attributes:
        source_type (str):
        lookup_id (str):
        ingestion_template_id (None | str):
    """

    source_type: str
    lookup_id: str
    ingestion_template_id: None | str

    def to_dict(self) -> dict[str, Any]:
        source_type = self.source_type

        lookup_id = self.lookup_id

        ingestion_template_id: None | str
        ingestion_template_id = self.ingestion_template_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "source_type": source_type,
                "lookup_id": lookup_id,
                "ingestion_template_id": ingestion_template_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        source_type = d.pop("source_type")

        lookup_id = d.pop("lookup_id")

        def _parse_ingestion_template_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        ingestion_template_id = _parse_ingestion_template_id(d.pop("ingestion_template_id"))

        list_cli_ingestion_keys_response_200_keys_item = cls(
            source_type=source_type,
            lookup_id=lookup_id,
            ingestion_template_id=ingestion_template_id,
        )

        return list_cli_ingestion_keys_response_200_keys_item
