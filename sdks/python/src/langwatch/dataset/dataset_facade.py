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
from .errors import DatasetApiError, DatasetNotFoundError
from .types import (
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
            ValueError: If name is empty (client-side validation).
            DatasetApiError: If the API returns a conflict (409) or other HTTP error.
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
            DatasetNotFoundError: If the dataset is not found (404).
        """
        tracer = NoOpTracer() if ignore_tracing else None
        raw = self._api.get_dataset(slug_or_id, tracer=tracer)
        entries = [DatasetEntry(**item) for item in raw.get("data", [])]
        return Dataset(
            id=raw.get("id", ""),
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
            DatasetNotFoundError: If the dataset is not found (404).
        """
        raw = self._api.update_dataset(slug_or_id, name=name, columns=columns)
        return DatasetInfo(**raw)

    def delete_dataset(self, slug_or_id: str) -> None:
        """
        Delete (archive) a dataset.

        Args:
            slug_or_id: Dataset slug or ID.

        Raises:
            DatasetNotFoundError: If the dataset is not found (404).
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
            DatasetNotFoundError: If the dataset is not found (404).
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
            ValueError: If entries is empty (client-side validation).
            DatasetNotFoundError: If the dataset is not found (404).
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
            DatasetNotFoundError: If the dataset is not found (404).
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
            ValueError: If record_ids is empty (client-side validation).
            DatasetNotFoundError: If the dataset is not found (404).
        """
        if not record_ids:
            raise ValueError("record_ids must not be empty.")

        return self._api.delete_records(slug_or_id, record_ids=record_ids)

    # ── file operations ─────────────────────────────────────────────

    _VALID_IF_EXISTS = {"append", "replace", "error"}

    def upload(
        self,
        slug_or_id: str,
        *,
        file_path: str,
        if_exists: str = "append",
        columns: Optional[List[Dict[str, str]]] = None,
    ) -> UploadResult:
        """
        Upload a file to a dataset, creating it if it does not exist.

        Follows the pandas ``if_exists`` pattern for conflict resolution:

        - ``"append"`` (default): append rows to the existing dataset,
          or create a new dataset if it does not exist.
        - ``"replace"``: delete all existing records first, then upload.
          Creates the dataset if it does not exist.
        - ``"error"``: raise ``DatasetApiError`` (409) if the dataset
          already exists. Creates it otherwise.

        Args:
            slug_or_id: Dataset slug or ID.
            file_path: Local path to a CSV, JSON, or JSONL file.
            if_exists: Conflict strategy -- ``"append"``, ``"replace"``,
                or ``"error"``.
            columns: Optional column type definitions (used only when
                creating a new dataset).

        Returns:
            UploadResult with record count and optional dataset metadata.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file extension is not supported or
                ``if_exists`` is invalid.
            DatasetApiError: If ``if_exists="error"`` and dataset exists.
        """
        self._validate_if_exists(if_exists)
        self._validate_file(file_path)

        if if_exists == "append":
            return self._upload_append(slug_or_id, file_path=file_path)
        elif if_exists == "replace":
            return self._upload_replace(slug_or_id, file_path=file_path)
        else:  # "error"
            return self._upload_error(slug_or_id, file_path=file_path)

    # ── upload strategy helpers ──────────────────────────────────────

    def _upload_append(self, slug_or_id: str, *, file_path: str) -> UploadResult:
        """Append to existing dataset, or create if not found."""
        try:
            raw = self._api.upload_to_existing(slug_or_id, file_path=file_path)
            return UploadResult(**raw)
        except DatasetNotFoundError:
            return self._create_from_file(slug_or_id, file_path=file_path)

    def _upload_replace(self, slug_or_id: str, *, file_path: str) -> UploadResult:
        """Delete all records then upload, or create if not found."""
        try:
            self._api.get_dataset(slug_or_id)
        except DatasetNotFoundError:
            return self._create_from_file(slug_or_id, file_path=file_path)

        self._delete_all_records(slug_or_id)
        raw = self._api.upload_to_existing(slug_or_id, file_path=file_path)
        return UploadResult(**raw)

    def _upload_error(self, slug_or_id: str, *, file_path: str) -> UploadResult:
        """Create only -- raise if dataset already exists."""
        try:
            self._api.get_dataset(slug_or_id)
        except DatasetNotFoundError:
            return self._create_from_file(slug_or_id, file_path=file_path)

        raise DatasetApiError(
            "Dataset already exists",
            status_code=409,
            operation="upload",
        )

    def _create_from_file(
        self, slug_or_id: str, *, file_path: str
    ) -> UploadResult:
        """Create a new dataset from a file and return an UploadResult."""
        raw = self._api.create_from_file(name=slug_or_id, file_path=file_path)
        dataset_info = DatasetInfo(**raw.get("dataset", raw))
        records_created = raw.get("recordsCreated", 0)
        return UploadResult(
            dataset=dataset_info,
            recordsCreated=records_created,
        )

    def _delete_all_records(self, slug_or_id: str) -> None:
        """Delete all records from a dataset in batches."""
        while True:
            page = self._api.list_records(slug_or_id, page=1, limit=1000)
            records = page.get("data", [])
            if not records:
                break
            record_ids = [r["id"] for r in records]
            self._api.delete_records(slug_or_id, record_ids=record_ids)

    # ── private helpers ─────────────────────────────────────────────

    @classmethod
    def _validate_if_exists(cls, if_exists: str) -> None:
        """Validate the if_exists parameter value."""
        if if_exists not in cls._VALID_IF_EXISTS:
            raise ValueError(
                f"Invalid if_exists value '{if_exists}'. "
                f"Must be one of: {', '.join(sorted(cls._VALID_IF_EXISTS))}"
            )

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
