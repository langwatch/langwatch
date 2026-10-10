from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_prompts_by_id_versions_response_200_item_demonstrations_inline_column_types_item import (
        GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineColumnTypesItem,
    )
    from ..models.get_api_prompts_by_id_versions_response_200_item_demonstrations_inline_records import (
        GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineRecords,
    )


T = TypeVar("T", bound="GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInline")


@_attrs_define
class GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInline:
    """
    Attributes:
        records (GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineRecords):
        column_types (list[GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineColumnTypesItem]):
    """

    records: GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineRecords
    column_types: list[GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineColumnTypesItem]

    def to_dict(self) -> dict[str, Any]:
        records = self.records.to_dict()

        column_types = []
        for column_types_item_data in self.column_types:
            column_types_item = column_types_item_data.to_dict()
            column_types.append(column_types_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "records": records,
                "columnTypes": column_types,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_prompts_by_id_versions_response_200_item_demonstrations_inline_column_types_item import (
            GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineColumnTypesItem,
        )
        from ..models.get_api_prompts_by_id_versions_response_200_item_demonstrations_inline_records import (
            GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineRecords,
        )

        d = dict(src_dict)
        records = GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineRecords.from_dict(d.pop("records"))

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = GetApiPromptsByIdVersionsResponse200ItemDemonstrationsInlineColumnTypesItem.from_dict(
                column_types_item_data
            )

            column_types.append(column_types_item)

        get_api_prompts_by_id_versions_response_200_item_demonstrations_inline = cls(
            records=records,
            column_types=column_types,
        )

        return get_api_prompts_by_id_versions_response_200_item_demonstrations_inline
