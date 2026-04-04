"""
Facade for the LangWatch Dataset module.

Provides a high-level, validated interface for dataset and record CRUD operations.
Client-side validation happens here (before any HTTP call) so that error messages
are clear and immediate. Orchestrates DatasetApiService for the actual HTTP work,
and converts raw dicts into typed Pydantic models.

Follows the same 3-layer pattern as the prompts module:
  DatasetsFacade -> DatasetApiService -> HTTP
"""

import os
from typing import Any, Dict, List, Optional

from opentelemetry.trace import NoOpTracer

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance

from .dataset_api_service import DatasetApiService
from .types import (
    CreateFromFileResult,
    Dataset,
    DatasetEntry,
    DatasetInfo,
    DatasetRecord,
    PaginatedResult,
    Pagination,
    UploadResult,
)

_SUPPORTED_EXTENSIONS = {".csv", ".json", ".jsonl"}


class DatasetsFacade:
    """
    High-level facade for dataset operations.

    All public methods perform client-side validation before delegating
    to DatasetApiService. Return values are typed Pydantic models.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._api = DatasetApiService(rest_api_client)

    @classmethod
    def from_global(cls) -> "DatasetsFacade":
        """Create a DatasetsFacade using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. "
                "Call langwatch.setup() first or set LANGWATCH_API_KEY."
            )
        return cls(instance.rest_api_client)

    # ── datasets ────────────────────────────────────────────────────

    def list_datasets(
        self,
        *,
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> PaginatedResult[DatasetInfo]:
        """
        List datasets for the current project.

        Args:
            page: 1-based page number (optional).
            limit: Maximum items per page (optional).

        Returns:
            PaginatedResult containing DatasetInfo items and pagination metadata.
        """
        raw = self._api.list_datasets(page=page, limit=limit)
        datasets = [DatasetInfo(**item) for item in raw.get("data", [])]
        pagination = Pagination(**raw.get("pagination", {}))
        return PaginatedResult[DatasetInfo](data=datasets, pagination=pagination)

    def create_dataset(
        self,
        name: str,
        *,
        columns: Optional[List[Dict[str, str]]] = None,
    ) -> DatasetInfo:
        """
        Create a new dataset.

        Args:
            name: Non-empty dataset name.
            columns: Optional column type definitions.

        Raises:
            ValueError: If name is empty or a dataset with the same name already exists (409).
        """
        if not name or not name.strip():
            raise ValueError("Dataset name is required and must not be empty.")

        raw = self._api.create_dataset(name=name, columns=columns)
        return DatasetInfo(**raw)

    def get_dataset(
        self,
        slug_or_id: str,
        *,
        ignore_tracing: bool = False,
    ) -> Dataset:
        """
        Get a dataset by slug or ID, including its entries.

        Args:
            slug_or_id: Dataset slug or ID.
            ignore_tracing: When True, uses a NoOpTracer so no span is emitted
                for this call. Matches the legacy GetDatasetOptions behavior.

        Returns:
            Dataset object with entries.

        Raises:
            ValueError: If the dataset is not found (404).
        """
        tracer = NoOpTracer() if ignore_tracing else None
        raw = self._api.get_dataset(slug_or_id, tracer=tracer)
        entries = [DatasetEntry(**item) for item in raw.get("data", [])]
        return Dataset(
            id=raw.get("datasetId", ""),
            name=raw.get("name", ""),
            slug=raw.get("slug", ""),
            entries=entries,
        )

    def update_dataset(
        self,
        slug_or_id: str,
        *,
        name: Optional[str] = None,
        columns: Optional[List[Dict[str, str]]] = None,
    ) -> DatasetInfo:
        """
        Update a dataset's metadata.

        Args:
            slug_or_id: Dataset slug or ID.
            name: New name (optional).
            columns: New column types (optional).

        Raises:
            ValueError: If the dataset is not found (404).
        """
        raw = self._api.update_dataset(slug_or_id, name=name, columns=columns)
        return DatasetInfo(**raw)

    def delete_dataset(self, slug_or_id: str) -> None:
        """
        Delete (archive) a dataset.

        Args:
            slug_or_id: Dataset slug or ID.

        Raises:
            ValueError: If the dataset is not found (404).
        """
        self._api.delete_dataset(slug_or_id)

    # ── records ─────────────────────────────────────────────────────

    def list_records(
        self,
        slug_or_id: str,
        *,
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> PaginatedResult[DatasetRecord]:
        """
        List records for a dataset with pagination.

        Args:
            slug_or_id: Dataset slug or ID.
            page: 1-based page number (optional).
            limit: Maximum items per page (optional).

        Returns:
            PaginatedResult containing DatasetRecord items and pagination metadata.

        Raises:
            ValueError: If the dataset is not found (404).
        """
        raw = self._api.list_records(slug_or_id, page=page, limit=limit)
        records = [DatasetRecord(**item) for item in raw.get("data", [])]
        pagination = Pagination(**raw.get("pagination", {}))
        return PaginatedResult[DatasetRecord](data=records, pagination=pagination)

    def create_records(
        self,
        slug_or_id: str,
        *,
        entries: List[Dict[str, Any]],
    ) -> List[DatasetRecord]:
        """
        Batch-create records in an existing dataset.

        Uses the new POST /:slugOrId/records endpoint which generates proper
        KSUIDs and returns the created records.

        Args:
            slug_or_id: Dataset slug or ID.
            entries: Non-empty list of record entry dicts.

        Returns:
            List of created DatasetRecord objects with their generated IDs.

        Raises:
            ValueError: If entries is empty or the dataset is not found.
        """
        if not entries:
            raise ValueError("Entries must not be empty.")

        raw_records = self._api.create_records(slug_or_id, entries=entries)
        return [DatasetRecord(**record) for record in raw_records]

    def update_record(
        self,
        slug_or_id: str,
        record_id: str,
        *,
        entry: Dict[str, Any],
    ) -> DatasetRecord:
        """
        Update (or upsert) a single record.

        Args:
            slug_or_id: Dataset slug or ID.
            record_id: Record ID to update.
            entry: New entry data.

        Returns:
            The updated DatasetRecord.

        Raises:
            ValueError: If the dataset is not found.
        """
        raw = self._api.update_record(slug_or_id, record_id, entry=entry)
        return DatasetRecord(**raw)

    def delete_records(
        self,
        slug_or_id: str,
        *,
        record_ids: List[str],
    ) -> int:
        """
        Batch-delete records by IDs.

        Args:
            slug_or_id: Dataset slug or ID.
            record_ids: Non-empty list of record IDs to delete.

        Returns:
            The number of records deleted.

        Raises:
            ValueError: If record_ids is empty or the dataset is not found.
        """
        if not record_ids:
            raise ValueError("record_ids must not be empty.")

        return self._api.delete_records(slug_or_id, record_ids=record_ids)

    # ── file operations ─────────────────────────────────────────────

    def upload(
        self,
        slug_or_id: str,
        *,
        file_path: str,
    ) -> UploadResult:
        """
        Upload a file (CSV or JSONL) to an existing dataset.

        Args:
            slug_or_id: Dataset slug or ID.
            file_path: Local path to the file.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file extension is not supported.
        """
        self._validate_file(file_path)

        raw = self._api.upload(slug_or_id, file_path=file_path)
        return UploadResult(**raw)

    def create_dataset_from_file(
        self,
        name: str,
        *,
        file_path: str,
    ) -> CreateFromFileResult:
        """
        Create a new dataset and populate it from a file in one call.

        Args:
            name: Dataset name.
            file_path: Local path to a CSV or JSONL file.

        Raises:
            ValueError: If name is empty.
            FileNotFoundError: If the file does not exist.
            ValueError: If the file extension is not supported.
        """
        if not name or not name.strip():
            raise ValueError("Dataset name is required and must not be empty.")

        self._validate_file(file_path)

        raw = self._api.create_dataset_from_file(name=name, file_path=file_path)
        dataset_info = DatasetInfo(**raw.get("dataset", raw))
        records_created = raw.get("recordsCreated", 0)
        return CreateFromFileResult(dataset=dataset_info, recordsCreated=records_created)

    # ── private helpers ─────────────────────────────────────────────

    @staticmethod
    def _validate_file(file_path: str) -> None:
        """Validate that a file exists and has a supported extension."""
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        _, ext = os.path.splitext(file_path)
        ext = ext.lower()
        if ext not in _SUPPORTED_EXTENSIONS:
            raise ValueError(
                f"Unsupported file format '{ext}'. "
                f"Supported formats: {', '.join(sorted(_SUPPORTED_EXTENSIONS))}"
            )
