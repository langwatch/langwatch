"""
Facade for the LangWatch Dataset module.

Provides a high-level, validated interface for dataset and record CRUD operations.
Client-side validation happens here (before any HTTP call) so that error messages
are clear and immediate. Orchestrates DatasetApiService for the actual HTTP work,
and converts raw dicts into typed Pydantic models.

Follows the same 3-layer pattern as the prompts module:
  DatasetsFacade -> DatasetApiService -> HTTP
"""

import json
import os
from typing import Any, Dict, List, Optional

from opentelemetry.trace import NoOpTracer

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance

from .dataset_api_service import DatasetApiService
from .errors import DatasetApiError, DatasetNotFoundError, DatasetUpsertKeyError
from .types import (
    Dataset,
    DatasetEntry,
    DatasetInfo,
    DatasetRecord,
    PaginatedResult,
    Pagination,
    UploadResult,
    UpsertResult,
)

_SUPPORTED_EXTENSIONS = {".csv", ".json", ".jsonl"}

# Rows sent per batch create: the smallest batch any plan accepts.
_CREATE_BATCH_SIZE = 1000


def _key_of(value: Any) -> str:
    """A value as sorted-key JSON, so 1 and "1" (and False and 0) stay different."""
    return json.dumps(value, sort_keys=True)


def _incoming_by_key(
    entries: List[Dict[str, Any]], key: str
) -> Dict[str, Dict[str, Any]]:
    """The entries by key, refusing one without the key and two that share a key."""
    incoming: Dict[str, Dict[str, Any]] = {}
    for entry in entries:
        if key not in entry:
            raise DatasetUpsertKeyError(
                f"Every entry must hold the key column '{key}'.",
                code="missing_upsert_key",
            )
        entry_key = _key_of(entry[key])
        if entry_key in incoming:
            raise DatasetUpsertKeyError(
                f"Two entries share the key {key}={entry[key]!r}.",
                code="duplicate_upsert_key",
            )
        incoming[entry_key] = entry
    return incoming


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
        entries: Optional[List[Dict[str, Any]]] = None,
    ) -> DatasetInfo:
        """
        Create a new dataset, optionally with its first rows, in one request.

        Args:
            name: Non-empty dataset name.
            columns: Optional column type definitions.
            entries: Optional first rows. Each key must be one of ``columns``.

        Raises:
            ValueError: If name is empty (client-side validation).
            DatasetApiError: If the API returns a conflict (409), refuses a row
                (422) or another HTTP error.
        """
        if not name or not name.strip():
            raise ValueError("Dataset name is required and must not be empty.")

        raw = self._api.create_dataset(name=name, columns=columns, entries=entries)
        return DatasetInfo(**raw)

    def get_dataset(
        self,
        slug_or_id: str,
        *,
        ignore_tracing: bool = False,
    ) -> Dataset:
        """
        Get a dataset by slug or ID, including its entries.

        The entries are read from the API page by page, so the dataset can be
        of any size. All of them are held in memory in the returned object.

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

    def upsert_records(
        self,
        slug_or_id: str,
        *,
        entries: List[Dict[str, Any]],
        key: str,
    ) -> UpsertResult:
        """
        Update or add rows, matching existing rows on a key column.

        For keeping a dataset in sync with rows held elsewhere, such as files in
        a repository. Each entry whose ``key`` value is already held by a row
        updates that row in place; columns the entry leaves out keep their
        values. An entry with a new key is added. A row the entry would not
        change is not written, so running it again with the same rows writes
        nothing.

        Args:
            slug_or_id: Dataset slug or ID.
            entries: The rows to upsert. Each must hold the ``key`` column.
            key: The column that identifies a row, such as ``"case_id"``.

        Returns:
            UpsertResult with the created and updated records and the number
            of rows left unchanged.

        Raises:
            DatasetUpsertKeyError: A ``ValueError`` whose ``code`` says why:
                an entry lacks the key, two entries share a key, or a key is
                held by more than one existing row. Nothing is written.
            DatasetNotFoundError: If the dataset is not found (404).
        """
        if not key:
            raise ValueError("key must name the column that identifies a row.")
        incoming = _incoming_by_key(entries, key)
        if not incoming:
            # Still a read, so a mistyped slug answers DatasetNotFoundError.
            self._api.list_records(slug_or_id, page=1, limit=1)
            return UpsertResult()

        existing = self._rows_by_key(slug_or_id, key, incoming)
        return self._write_upserts(slug_or_id, incoming, existing)

    def _write_upserts(
        self,
        slug_or_id: str,
        incoming: Dict[str, Dict[str, Any]],
        existing: Dict[str, List[Dict[str, Any]]],
    ) -> UpsertResult:
        """Patches the rows an entry changes and adds the new keys in plan-sized batches."""
        result = UpsertResult()
        to_create: List[Dict[str, Any]] = []
        for entry_key, entry in incoming.items():
            matches = existing.get(entry_key)
            if not matches:
                to_create.append(entry)
                continue
            record = matches[0]
            held = record.get("entry") or {}
            merged = {**held, **entry}
            if _key_of(merged) == _key_of(held):
                result.unchanged += 1
                continue
            updated = self._api.update_record(slug_or_id, record["id"], entry=merged)
            result.updated.append(DatasetRecord(**updated))

        for start in range(0, len(to_create), _CREATE_BATCH_SIZE):
            batch = to_create[start : start + _CREATE_BATCH_SIZE]
            created = self._api.create_records(slug_or_id, entries=batch)
            result.created.extend(DatasetRecord(**record) for record in created)
        return result

    def _rows_by_key(
        self, slug_or_id: str, key: str, incoming: Dict[str, Dict[str, Any]]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """The dataset's rows grouped by key, refusing a key an entry names that two rows hold."""
        existing: Dict[str, List[Dict[str, Any]]] = {}
        for record in self._api.get_dataset(slug_or_id).get("data", []):
            held = record.get("entry") or {}
            if key in held:
                existing.setdefault(_key_of(held[key]), []).append(record)
        duplicated = [
            repr(existing[entry_key][0]["entry"][key])
            for entry_key in incoming
            if len(existing.get(entry_key, [])) > 1
        ]
        if duplicated:
            raise DatasetUpsertKeyError(
                f"More than one row holds {key} = {', '.join(duplicated)}. "
                "Delete the extra rows, then upsert again.",
                code="dataset_has_duplicate_key",
            )
        return existing

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
        if not self._api.dataset_exists(slug_or_id):
            return self._create_from_file(slug_or_id, file_path=file_path)

        self._delete_all_records(slug_or_id)
        raw = self._api.upload_to_existing(slug_or_id, file_path=file_path)
        return UploadResult(**raw)

    def _upload_error(self, slug_or_id: str, *, file_path: str) -> UploadResult:
        """Create only -- raise if dataset already exists."""
        if not self._api.dataset_exists(slug_or_id):
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
