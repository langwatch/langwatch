from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_cli_ingestion_templates_response_200_ingestion_templates_item import (
        ListCliIngestionTemplatesResponse200IngestionTemplatesItem,
    )


T = TypeVar("T", bound="ListCliIngestionTemplatesResponse200")


@_attrs_define
class ListCliIngestionTemplatesResponse200:
    """
    Attributes:
        ingestion_templates (list[ListCliIngestionTemplatesResponse200IngestionTemplatesItem]):
    """

    ingestion_templates: list[ListCliIngestionTemplatesResponse200IngestionTemplatesItem]

    def to_dict(self) -> dict[str, Any]:
        ingestion_templates = []
        for ingestion_templates_item_data in self.ingestion_templates:
            ingestion_templates_item = ingestion_templates_item_data.to_dict()
            ingestion_templates.append(ingestion_templates_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ingestion_templates": ingestion_templates,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_cli_ingestion_templates_response_200_ingestion_templates_item import (
            ListCliIngestionTemplatesResponse200IngestionTemplatesItem,
        )

        d = dict(src_dict)
        ingestion_templates = []
        _ingestion_templates = d.pop("ingestion_templates")
        for ingestion_templates_item_data in _ingestion_templates:
            ingestion_templates_item = ListCliIngestionTemplatesResponse200IngestionTemplatesItem.from_dict(
                ingestion_templates_item_data
            )

            ingestion_templates.append(ingestion_templates_item)

        list_cli_ingestion_templates_response_200 = cls(
            ingestion_templates=ingestion_templates,
        )

        return list_cli_ingestion_templates_response_200
