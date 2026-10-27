from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_cli_ingestion_sources_response_200_sources_item import (
        ListCliIngestionSourcesResponse200SourcesItem,
    )


T = TypeVar("T", bound="ListCliIngestionSourcesResponse200")


@_attrs_define
class ListCliIngestionSourcesResponse200:
    """
    Attributes:
        sources (list[ListCliIngestionSourcesResponse200SourcesItem]):
    """

    sources: list[ListCliIngestionSourcesResponse200SourcesItem]

    def to_dict(self) -> dict[str, Any]:
        sources = []
        for sources_item_data in self.sources:
            sources_item = sources_item_data.to_dict()
            sources.append(sources_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sources": sources,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_cli_ingestion_sources_response_200_sources_item import (
            ListCliIngestionSourcesResponse200SourcesItem,
        )

        d = dict(src_dict)
        sources = []
        _sources = d.pop("sources")
        for sources_item_data in _sources:
            sources_item = ListCliIngestionSourcesResponse200SourcesItem.from_dict(sources_item_data)

            sources.append(sources_item)

        list_cli_ingestion_sources_response_200 = cls(
            sources=sources,
        )

        return list_cli_ingestion_sources_response_200
