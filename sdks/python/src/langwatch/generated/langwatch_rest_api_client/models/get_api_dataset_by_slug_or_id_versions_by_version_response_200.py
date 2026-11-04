from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_pagination import (
        GetApiDatasetBySlugOrIdVersionsByVersionResponse200Pagination,
    )
    from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_rows_item import (
        GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItem,
    )
    from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_version import (
        GetApiDatasetBySlugOrIdVersionsByVersionResponse200Version,
    )


T = TypeVar("T", bound="GetApiDatasetBySlugOrIdVersionsByVersionResponse200")


@_attrs_define
class GetApiDatasetBySlugOrIdVersionsByVersionResponse200:
    """
    Attributes:
        version (GetApiDatasetBySlugOrIdVersionsByVersionResponse200Version):
        rows (list[GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItem]):
        pagination (GetApiDatasetBySlugOrIdVersionsByVersionResponse200Pagination):
    """

    version: GetApiDatasetBySlugOrIdVersionsByVersionResponse200Version
    rows: list[GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItem]
    pagination: GetApiDatasetBySlugOrIdVersionsByVersionResponse200Pagination

    def to_dict(self) -> dict[str, Any]:
        version = self.version.to_dict()

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "rows": rows,
                "pagination": pagination,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_pagination import (
            GetApiDatasetBySlugOrIdVersionsByVersionResponse200Pagination,
        )
        from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_rows_item import (
            GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItem,
        )
        from ..models.get_api_dataset_by_slug_or_id_versions_by_version_response_200_version import (
            GetApiDatasetBySlugOrIdVersionsByVersionResponse200Version,
        )

        d = dict(src_dict)
        version = GetApiDatasetBySlugOrIdVersionsByVersionResponse200Version.from_dict(d.pop("version"))

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = GetApiDatasetBySlugOrIdVersionsByVersionResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        pagination = GetApiDatasetBySlugOrIdVersionsByVersionResponse200Pagination.from_dict(d.pop("pagination"))

        get_api_dataset_by_slug_or_id_versions_by_version_response_200 = cls(
            version=version,
            rows=rows,
            pagination=pagination,
        )

        return get_api_dataset_by_slug_or_id_versions_by_version_response_200
