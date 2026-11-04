from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_rows_item_entry import (
        GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItemEntry,
    )


T = TypeVar("T", bound="GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItem")


@_attrs_define
class GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItem:
    """
    Attributes:
        id (str):
        entry (GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItemEntry):
    """

    id: str
    entry: GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItemEntry

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        entry = self.entry.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "entry": entry,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_rows_item_entry import (
            GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItemEntry,
        )

        d = dict(src_dict)
        id = d.pop("id")

        entry = GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItemEntry.from_dict(d.pop("entry"))

        get_api_dataset_by_slug_or_id_versions_by_version_response_200_rows_item = cls(
            id=id,
            entry=entry,
        )

        return get_api_dataset_by_slug_or_id_versions_by_version_response_200_rows_item
