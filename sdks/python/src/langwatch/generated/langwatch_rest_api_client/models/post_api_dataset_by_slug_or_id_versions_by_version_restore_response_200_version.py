from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version_author_kind_type_0 import (
    PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionAuthorKindType0,
)
from ..models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version_trigger import (
    PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionTrigger,
)

if TYPE_CHECKING:
    from ..models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version_column_types_item import (
        PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItem,
    )


T = TypeVar("T", bound="PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200Version")


@_attrs_define
class PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200Version:
    """
    Attributes:
        id (str):
        project_id (str):
        dataset_id (str):
        version (int):
        name (None | str):
        trigger (PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionTrigger):
        content_hash (str):
        column_types (list[PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItem]):
        row_count (int):
        size_bytes (int):
        chunk_count (int):
        restored_from_version (int | None):
        author_id (None | str):
        author_kind (None | PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionAuthorKindType0):
        pinned (bool):
        run_count (int):
        created_at (datetime.datetime):
    """

    id: str
    project_id: str
    dataset_id: str
    version: int
    name: None | str
    trigger: PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionTrigger
    content_hash: str
    column_types: list[PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItem]
    row_count: int
    size_bytes: int
    chunk_count: int
    restored_from_version: int | None
    author_id: None | str
    author_kind: None | PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionAuthorKindType0
    pinned: bool
    run_count: int
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        dataset_id = self.dataset_id

        version = self.version

        name: None | str
        name = self.name

        trigger = self.trigger.value

        content_hash = self.content_hash

        column_types = []
        for column_types_item_data in self.column_types:
            column_types_item = column_types_item_data.to_dict()
            column_types.append(column_types_item)

        row_count = self.row_count

        size_bytes = self.size_bytes

        chunk_count = self.chunk_count

        restored_from_version: int | None
        restored_from_version = self.restored_from_version

        author_id: None | str
        author_id = self.author_id

        author_kind: None | str
        if isinstance(
            self.author_kind, PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionAuthorKindType0
        ):
            author_kind = self.author_kind.value
        else:
            author_kind = self.author_kind

        pinned = self.pinned

        run_count = self.run_count

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "projectId": project_id,
                "datasetId": dataset_id,
                "version": version,
                "name": name,
                "trigger": trigger,
                "contentHash": content_hash,
                "columnTypes": column_types,
                "rowCount": row_count,
                "sizeBytes": size_bytes,
                "chunkCount": chunk_count,
                "restoredFromVersion": restored_from_version,
                "authorId": author_id,
                "authorKind": author_kind,
                "pinned": pinned,
                "runCount": run_count,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version_column_types_item import (
            PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        dataset_id = d.pop("datasetId")

        version = d.pop("version")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        trigger = PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionTrigger(d.pop("trigger"))

        content_hash = d.pop("contentHash")

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = (
                PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionColumnTypesItem.from_dict(
                    column_types_item_data
                )
            )

            column_types.append(column_types_item)

        row_count = d.pop("rowCount")

        size_bytes = d.pop("sizeBytes")

        chunk_count = d.pop("chunkCount")

        def _parse_restored_from_version(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        restored_from_version = _parse_restored_from_version(d.pop("restoredFromVersion"))

        def _parse_author_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        author_id = _parse_author_id(d.pop("authorId"))

        def _parse_author_kind(
            data: object,
        ) -> None | PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionAuthorKindType0:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                author_kind_type_0 = PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionAuthorKindType0(
                    data
                )

                return author_kind_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200VersionAuthorKindType0, data)

        author_kind = _parse_author_kind(d.pop("authorKind"))

        pinned = d.pop("pinned")

        run_count = d.pop("runCount")

        created_at = isoparse(d.pop("createdAt"))

        post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version = cls(
            id=id,
            project_id=project_id,
            dataset_id=dataset_id,
            version=version,
            name=name,
            trigger=trigger,
            content_hash=content_hash,
            column_types=column_types,
            row_count=row_count,
            size_bytes=size_bytes,
            chunk_count=chunk_count,
            restored_from_version=restored_from_version,
            author_id=author_id,
            author_kind=author_kind,
            pinned=pinned,
            run_count=run_count,
            created_at=created_at,
        )

        return post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200_version
