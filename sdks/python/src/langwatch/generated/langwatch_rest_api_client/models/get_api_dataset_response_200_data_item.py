from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.get_api_dataset_response_200_data_item_content_layout import GetApiDatasetResponse200DataItemContentLayout
from ..models.get_api_dataset_response_200_data_item_status import GetApiDatasetResponse200DataItemStatus

if TYPE_CHECKING:
    from ..models.get_api_dataset_response_200_data_item_column_types_item import (
        GetApiDatasetResponse200DataItemColumnTypesItem,
    )


T = TypeVar("T", bound="GetApiDatasetResponse200DataItem")


@_attrs_define
class GetApiDatasetResponse200DataItem:
    """
    Attributes:
        id (str):
        project_id (str):
        name (str):
        slug (str):
        column_types (list[GetApiDatasetResponse200DataItemColumnTypesItem]):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        archived_at (datetime.datetime | None):
        mapping (Any | None):
        use_s3 (bool):
        s_3_record_count (int | None):
        content_layout (GetApiDatasetResponse200DataItemContentLayout):
        status (GetApiDatasetResponse200DataItemStatus):
        status_error (None | str):
        staging_key (None | str):
        upload_filename (None | str):
        row_count (int | None):
        size_bytes (Any | None):
        chunk_count (int | None):
        chunk_offsets (Any | None):
        record_count (int):
        platform_url (str):
    """

    id: str
    project_id: str
    name: str
    slug: str
    column_types: list[GetApiDatasetResponse200DataItemColumnTypesItem]
    created_at: datetime.datetime
    updated_at: datetime.datetime
    archived_at: datetime.datetime | None
    mapping: Any | None
    use_s3: bool
    s_3_record_count: int | None
    content_layout: GetApiDatasetResponse200DataItemContentLayout
    status: GetApiDatasetResponse200DataItemStatus
    status_error: None | str
    staging_key: None | str
    upload_filename: None | str
    row_count: int | None
    size_bytes: Any | None
    chunk_count: int | None
    chunk_offsets: Any | None
    record_count: int
    platform_url: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        name = self.name

        slug = self.slug

        column_types = []
        for column_types_item_data in self.column_types:
            column_types_item = column_types_item_data.to_dict()
            column_types.append(column_types_item)

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        archived_at: None | str
        if isinstance(self.archived_at, datetime.datetime):
            archived_at = self.archived_at.isoformat()
        else:
            archived_at = self.archived_at

        mapping: Any | None
        mapping = self.mapping

        use_s3 = self.use_s3

        s_3_record_count: int | None
        s_3_record_count = self.s_3_record_count

        content_layout = self.content_layout.value

        status = self.status.value

        status_error: None | str
        status_error = self.status_error

        staging_key: None | str
        staging_key = self.staging_key

        upload_filename: None | str
        upload_filename = self.upload_filename

        row_count: int | None
        row_count = self.row_count

        size_bytes: Any | None
        size_bytes = self.size_bytes

        chunk_count: int | None
        chunk_count = self.chunk_count

        chunk_offsets: Any | None
        chunk_offsets = self.chunk_offsets

        record_count = self.record_count

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "projectId": project_id,
                "name": name,
                "slug": slug,
                "columnTypes": column_types,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "archivedAt": archived_at,
                "mapping": mapping,
                "useS3": use_s3,
                "s3RecordCount": s_3_record_count,
                "contentLayout": content_layout,
                "status": status,
                "statusError": status_error,
                "stagingKey": staging_key,
                "uploadFilename": upload_filename,
                "rowCount": row_count,
                "sizeBytes": size_bytes,
                "chunkCount": chunk_count,
                "chunkOffsets": chunk_offsets,
                "recordCount": record_count,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_response_200_data_item_column_types_item import (
            GetApiDatasetResponse200DataItemColumnTypesItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        name = d.pop("name")

        slug = d.pop("slug")

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = GetApiDatasetResponse200DataItemColumnTypesItem.from_dict(column_types_item_data)

            column_types.append(column_types_item)

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        def _parse_archived_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                archived_at_type_0 = isoparse(data)

                return archived_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))

        def _parse_mapping(data: object) -> Any | None:
            if data is None:
                return data
            return cast(Any | None, data)

        mapping = _parse_mapping(d.pop("mapping"))

        use_s3 = d.pop("useS3")

        def _parse_s_3_record_count(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        s_3_record_count = _parse_s_3_record_count(d.pop("s3RecordCount"))

        content_layout = GetApiDatasetResponse200DataItemContentLayout(d.pop("contentLayout"))

        status = GetApiDatasetResponse200DataItemStatus(d.pop("status"))

        def _parse_status_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        status_error = _parse_status_error(d.pop("statusError"))

        def _parse_staging_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        staging_key = _parse_staging_key(d.pop("stagingKey"))

        def _parse_upload_filename(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        upload_filename = _parse_upload_filename(d.pop("uploadFilename"))

        def _parse_row_count(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        row_count = _parse_row_count(d.pop("rowCount"))

        def _parse_size_bytes(data: object) -> Any | None:
            if data is None:
                return data
            return cast(Any | None, data)

        size_bytes = _parse_size_bytes(d.pop("sizeBytes"))

        def _parse_chunk_count(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        chunk_count = _parse_chunk_count(d.pop("chunkCount"))

        def _parse_chunk_offsets(data: object) -> Any | None:
            if data is None:
                return data
            return cast(Any | None, data)

        chunk_offsets = _parse_chunk_offsets(d.pop("chunkOffsets"))

        record_count = d.pop("recordCount")

        platform_url = d.pop("platformUrl")

        get_api_dataset_response_200_data_item = cls(
            id=id,
            project_id=project_id,
            name=name,
            slug=slug,
            column_types=column_types,
            created_at=created_at,
            updated_at=updated_at,
            archived_at=archived_at,
            mapping=mapping,
            use_s3=use_s3,
            s_3_record_count=s_3_record_count,
            content_layout=content_layout,
            status=status,
            status_error=status_error,
            staging_key=staging_key,
            upload_filename=upload_filename,
            row_count=row_count,
            size_bytes=size_bytes,
            chunk_count=chunk_count,
            chunk_offsets=chunk_offsets,
            record_count=record_count,
            platform_url=platform_url,
        )

        return get_api_dataset_response_200_data_item
