"""
API service layer for LangWatch Dataset operations.

Encapsulates all HTTP calls to dataset endpoints using hand-rolled httpx,
since the generated OpenAPI client only covers a subset of dataset endpoints.

Uses rest_api_client.get_httpx_client() for transport (like the experiment module)
and _raise_for_api_status() for error surfacing.
"""

import os
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import httpx
from opentelemetry import trace

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from .errors import DatasetApiError, DatasetNotFoundError, DatasetPlanLimitError
from langwatch.utils.exceptions import (
    extract_api_error_code,
    extract_api_error_detail,
)

_tracer = trace.get_tracer(__name__)

# Rows asked for on the first page of a whole-dataset read, and the most asked
# for on any page. The first page is small because nothing is known yet about
# the size of the rows. Both are powers of two, so the page size can be halved
# and doubled while the rows already read stay a whole number of pages.
_RECORDS_PAGE_LIMIT_START = 16
_RECORDS_PAGE_LIMIT_MAX = 512

# The page size a whole-dataset read steers toward. Rows can hold inline images
# of many megabytes, so pages are sized by their bytes and not only their rows.
_RECORDS_PAGE_TARGET_BYTES = 16 * 1024 * 1024

# Datasets asked for per page when looking up one dataset's metadata.
_DATASETS_PAGE_LIMIT = 1000


def _is_page_too_large(response: httpx.Response) -> bool:
    """Whether the server refused a records page for its size.

    The platform answers 413 with the code ``dataset_page_too_large``. Any 413
    is read the same way, and so is a 400 or 422 whose code names a size refusal.
    """
    if response.status_code == 413:
        return True
    if response.status_code not in (400, 422):
        return False
    try:
        code = extract_api_error_code(response.json())
    except Exception:
        return False
    return code is not None and "too_large" in code


def _suggested_page_limit(
    response: httpx.Response, *, limit: int, rows_read: int
) -> Optional[int]:
    """The smaller page size a refusal names in ``meta.suggestedLimit``, or None.

    It is used only when the rows already read are a whole number of pages of
    that size, so the next page starts exactly where the last one ended.
    """
    try:
        body = response.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    inner = body.get("error")
    meta = (inner if isinstance(inner, dict) else body).get("meta")
    suggested = meta.get("suggestedLimit") if isinstance(meta, dict) else None
    if isinstance(suggested, bool) or not isinstance(suggested, int):
        return None
    if not 1 <= suggested < limit or rows_read % suggested != 0:
        return None
    return suggested


def _next_page_limit(
    limit: int, *, rows_read: int, page_rows: int, page_bytes: int, may_grow: bool
) -> int:
    """The page size for the next request, from the size of the page just read.

    Halves while a page of that many rows would pass the byte target, and
    doubles toward the largest page size while it would stay under it. It only
    doubles when the rows already read are a whole number of the larger pages,
    so the next page starts exactly where this one ended.
    """
    row_bytes = max(1, page_bytes // max(1, page_rows))
    while limit > 1 and limit * row_bytes > _RECORDS_PAGE_TARGET_BYTES:
        limit //= 2
    while (
        may_grow
        and limit < _RECORDS_PAGE_LIMIT_MAX
        and rows_read % (limit * 2) == 0
        and limit * 2 * row_bytes <= _RECORDS_PAGE_TARGET_BYTES
    ):
        limit *= 2
    return limit


def _raise_for_api_status(
    response: httpx.Response, *, operation: str = ""
) -> None:
    """
    Map HTTP error status codes to the SDK's custom error hierarchy.

    - 404              -> DatasetNotFoundError
    - 403 + limitType  -> DatasetPlanLimitError
    - 400, 401, 403 (without limitType), 409, 422, 5xx -> DatasetApiError

    Extracts the ``message`` or ``error`` field from JSON body when available.
    """
    if response.is_success:
        return

    status = response.status_code
    detail = ""
    body: dict = {}
    try:
        body = response.json()
        detail = extract_api_error_detail(body)
    except Exception:
        detail = response.text or ""

    if status == 404:
        raise DatasetNotFoundError(
            f"Not found: {detail}" if detail else "Not found"
        )

    if status == 403:
        limit_type = body.get("limitType")
        if limit_type:
            raise DatasetPlanLimitError(
                detail or "Plan limit exceeded",
                limit_type=limit_type,
                current=body.get("current"),
                max=body.get("max"),
                upgrade_url=body.get("upgradeUrl"),
            )
        raise DatasetApiError(
            f"Forbidden: {detail}" if detail else "Forbidden",
            status_code=403,
            operation=operation,
        )

    if status == 400:
        raise DatasetApiError(
            f"Bad request: {detail}" if detail else "Bad request",
            status_code=400,
            operation=operation,
        )
    if status == 401:
        raise DatasetApiError(
            f"Authentication failed: {detail}"
            if detail
            else "Authentication failed",
            status_code=401,
            operation=operation,
        )
    if status == 409:
        raise DatasetApiError(
            f"Conflict: {detail}" if detail else "Conflict",
            status_code=409,
            operation=operation,
        )
    if status == 422:
        raise DatasetApiError(
            f"Validation error: {detail}" if detail else "Validation error",
            status_code=422,
            operation=operation,
        )
    if status >= 500:
        raise DatasetApiError(
            f"Server error ({status}): {detail}"
            if detail
            else f"Server error ({status})",
            status_code=status,
            operation=operation,
        )

    # Fallback for any other non-success status
    raise DatasetApiError(
        f"Unexpected status {status}: {detail}",
        status_code=status,
        operation=operation,
    )


class DatasetApiService:
    """
    Low-level HTTP service for dataset CRUD operations.

    All public methods correspond 1:1 to REST endpoints.
    This class owns no business logic -- validation and orchestration
    live in DatasetsFacade.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    # ── helpers ──────────────────────────────────────────────────────

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    @staticmethod
    def _quote(value: str) -> str:
        """URL-quote a path segment so special characters are percent-encoded."""
        return urllib.parse.quote(value, safe="")

    # ── datasets ────────────────────────────────────────────────────

    def list_datasets(
        self,
        *,
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """GET /api/v1/dataset -- list datasets for the project."""
        with _tracer.start_as_current_span("dataset.list_datasets"):
            params: Dict[str, Any] = {}
            if page is not None:
                params["page"] = page
            if limit is not None:
                params["limit"] = limit

            response = self._http().get("/api/v1/dataset", params=params)
            _raise_for_api_status(response, operation="list_datasets")
            return response.json()

    def create_dataset(
        self,
        *,
        name: str,
        columns: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """POST /api/v1/dataset -- create a new dataset."""
        with _tracer.start_as_current_span("dataset.create_dataset"):
            body: Dict[str, Any] = {"name": name}
            if columns is not None:
                body["columnTypes"] = columns

            response = self._http().post("/api/v1/dataset", json=body)
            _raise_for_api_status(response, operation="create_dataset")
            return response.json()

    def get_dataset(
        self,
        slug_or_id: str,
        *,
        tracer: Optional[trace.Tracer] = None,
    ) -> Dict[str, Any]:
        """Get a dataset with all its entries.

        The entries are read page by page from
        ``GET /api/v1/dataset/{slugOrId}/records``, so a dataset of any size can
        be read. The answer has the shape of ``GET /api/v1/dataset/{slugOrId}``:
        the dataset's metadata with every record under ``data``. A server
        without the records endpoint is asked for the whole dataset in one
        request instead.
        """
        active_tracer = tracer or _tracer
        with active_tracer.start_as_current_span("dataset.get_dataset") as span:
            span.set_attribute("inputs.slug_or_id", slug_or_id)

            quoted = self._quote(slug_or_id)
            try:
                records, metadata = self._read_all_records(quoted)
            except DatasetNotFoundError:
                # Either the dataset does not exist or the server has no records
                # endpoint. The single request tells the two apart.
                return self._get_dataset_inline(quoted)

            # A server that does not send the dataset with its records pages is
            # asked for it through the datasets list, then through the single
            # request, which refuses a dataset too large for one response.
            if metadata is None:
                metadata = self._find_dataset_metadata(slug_or_id, records)
            if metadata is None:
                return self._get_dataset_inline(quoted)
            return {**metadata, "data": records}

    def dataset_exists(self, slug_or_id: str) -> bool:
        """Whether a dataset exists, without reading its entries."""
        with _tracer.start_as_current_span("dataset.dataset_exists"):
            quoted = self._quote(slug_or_id)
            response = self._http().get(
                f"/api/v1/dataset/{quoted}/records", params={"page": 1, "limit": 1}
            )
            if response.status_code != 404:
                _raise_for_api_status(response, operation="dataset_exists")
                return True
            try:
                self._get_dataset_inline(quoted)
            except DatasetNotFoundError:
                return False
            return True

    def _get_dataset_inline(self, quoted_slug_or_id: str) -> Dict[str, Any]:
        """GET /api/v1/dataset/{slugOrId} -- the dataset and its entries in one response."""
        response = self._http().get(f"/api/v1/dataset/{quoted_slug_or_id}")
        _raise_for_api_status(response, operation="get_dataset")
        return response.json()

    def _read_all_records(
        self, quoted_slug_or_id: str
    ) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """Read every record of a dataset in order, one page at a time.

        Answers the records and the dataset's metadata, which is None when the
        server does not send it with a page. A page the server refuses as too
        large is asked for again with the page size the refusal suggests, or
        half the rows, down to one row. The page number is derived from the
        rows already read, which the page size always divides.
        """
        records: List[Dict[str, Any]] = []
        metadata: Optional[Dict[str, Any]] = None
        limit = _RECORDS_PAGE_LIMIT_START
        # A page grown from a smaller one can be refused when the server's own
        # cap is under the byte target. Each such refusal doubles the number of
        # pages read before the next attempt to grow, so a dataset of evenly
        # large rows costs only a few refused requests.
        grown = False
        growth_backoff_pages = 1
        pages_until_growth = 0
        while True:
            response = self._http().get(
                f"/api/v1/dataset/{quoted_slug_or_id}/records",
                params={"page": len(records) // limit + 1, "limit": limit},
            )
            if limit > 1 and _is_page_too_large(response):
                limit = _suggested_page_limit(
                    response, limit=limit, rows_read=len(records)
                ) or limit // 2
                if grown:
                    pages_until_growth = growth_backoff_pages
                    growth_backoff_pages *= 2
                    grown = False
                continue
            _raise_for_api_status(response, operation="get_dataset")
            if grown:
                growth_backoff_pages = 1

            body = response.json()
            rows = body.get("data") or []
            records.extend(rows)
            if metadata is None and isinstance(body.get("dataset"), dict):
                metadata = body["dataset"]

            total = (body.get("pagination") or {}).get("total")
            read_all = isinstance(total, int) and len(records) >= total
            if len(rows) < limit or read_all:
                return records, metadata

            next_limit = _next_page_limit(
                limit,
                rows_read=len(records),
                page_rows=len(rows),
                page_bytes=len(response.content),
                may_grow=pages_until_growth == 0,
            )
            pages_until_growth = max(0, pages_until_growth - 1)
            grown = next_limit > limit
            limit = next_limit

    def _find_dataset_metadata(
        self, slug_or_id: str, records: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """The dataset's metadata from the datasets list, or None when it is not listed.

        The records name their dataset by id, which settles the match when the
        caller passed a slug that is also another dataset's id.
        """
        dataset_id = records[0].get("datasetId") if records else None
        page = 1
        while True:
            response = self._http().get(
                "/api/v1/dataset",
                params={"page": page, "limit": _DATASETS_PAGE_LIMIT},
            )
            if response.status_code == 404:
                return None
            _raise_for_api_status(response, operation="get_dataset")

            body = response.json()
            datasets = body.get("data") or []
            for dataset in datasets:
                if dataset_id is not None:
                    if dataset.get("id") == dataset_id:
                        return self._without_record_count(dataset)
                elif slug_or_id in (dataset.get("id"), dataset.get("slug")):
                    return self._without_record_count(dataset)

            total_pages = (body.get("pagination") or {}).get("totalPages")
            last_page = isinstance(total_pages, int) and page >= total_pages
            if not datasets or last_page or not isinstance(total_pages, int):
                return None
            page += 1

    @staticmethod
    def _without_record_count(dataset: Dict[str, Any]) -> Dict[str, Any]:
        return {key: value for key, value in dataset.items() if key != "recordCount"}

    def update_dataset(
        self,
        slug_or_id: str,
        *,
        name: Optional[str] = None,
        columns: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """PATCH /api/v1/dataset/{slugOrId} -- update dataset metadata."""
        with _tracer.start_as_current_span("dataset.update_dataset"):
            body: Dict[str, Any] = {}
            if name is not None:
                body["name"] = name
            if columns is not None:
                body["columnTypes"] = columns

            quoted = self._quote(slug_or_id)
            response = self._http().patch(f"/api/v1/dataset/{quoted}", json=body)
            _raise_for_api_status(response, operation="update_dataset")
            return response.json()

    def delete_dataset(self, slug_or_id: str) -> None:
        """DELETE /api/v1/dataset/{slugOrId} -- archive a dataset."""
        with _tracer.start_as_current_span("dataset.delete_dataset"):
            quoted = self._quote(slug_or_id)
            response = self._http().delete(f"/api/v1/dataset/{quoted}")
            _raise_for_api_status(response, operation="delete_dataset")

    # ── records ─────────────────────────────────────────────────────

    def list_records(
        self,
        slug_or_id: str,
        *,
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """GET /api/v1/dataset/{slugOrId}/records -- list records with pagination."""
        with _tracer.start_as_current_span("dataset.list_records"):
            params: Dict[str, Any] = {}
            if page is not None:
                params["page"] = page
            if limit is not None:
                params["limit"] = limit

            quoted = self._quote(slug_or_id)
            response = self._http().get(
                f"/api/v1/dataset/{quoted}/records", params=params
            )
            _raise_for_api_status(response, operation="list_records")
            return response.json()

    def create_records(
        self,
        slug_or_id: str,
        *,
        entries: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """POST /api/v1/dataset/{slugOrId}/records -- batch-create records.

        Returns:
            List of created record dicts, each containing id, entry, and createdAt.
        """
        with _tracer.start_as_current_span("dataset.create_records"):
            body: Dict[str, Any] = {"entries": entries}

            quoted = self._quote(slug_or_id)
            response = self._http().post(
                f"/api/v1/dataset/{quoted}/records", json=body
            )
            _raise_for_api_status(response, operation="create_records")
            data = response.json()
            return data.get("data", [])

    def update_record(
        self,
        slug_or_id: str,
        record_id: str,
        *,
        entry: Dict[str, Any],
    ) -> Dict[str, Any]:
        """PATCH /api/v1/dataset/{slugOrId}/records/{recordId} -- update a single record."""
        with _tracer.start_as_current_span("dataset.update_record"):
            body: Dict[str, Any] = {"entry": entry}

            quoted_slug = self._quote(slug_or_id)
            quoted_record = self._quote(record_id)
            response = self._http().patch(
                f"/api/v1/dataset/{quoted_slug}/records/{quoted_record}", json=body
            )
            _raise_for_api_status(response, operation="update_record")
            return response.json()

    def delete_records(
        self,
        slug_or_id: str,
        *,
        record_ids: List[str],
    ) -> int:
        """DELETE /api/v1/dataset/{slugOrId}/records -- batch-delete records.

        Returns:
            The number of records deleted.
        """
        with _tracer.start_as_current_span("dataset.delete_records"):
            body: Dict[str, Any] = {"recordIds": record_ids}

            quoted = self._quote(slug_or_id)
            response = self._http().request(
                "DELETE",
                f"/api/v1/dataset/{quoted}/records",
                json=body,
            )
            _raise_for_api_status(response, operation="delete_records")
            data = response.json()
            return int(data.get("deletedCount", 0))

    # ── file upload ─────────────────────────────────────────────────

    def upload_to_existing(
        self,
        slug_or_id: str,
        *,
        file_path: str,
    ) -> Dict[str, Any]:
        """POST /api/v1/dataset/{slugOrId}/upload -- upload a file to an existing dataset."""
        with _tracer.start_as_current_span("dataset.upload_to_existing"):
            quoted = self._quote(slug_or_id)
            with open(file_path, "rb") as f:
                response = self._http().post(
                    f"/api/v1/dataset/{quoted}/upload",
                    files={"file": (os.path.basename(file_path), f)},
                )
            _raise_for_api_status(response, operation="upload_to_existing")
            return response.json()

    def create_from_file(
        self,
        *,
        name: str,
        file_path: str,
    ) -> Dict[str, Any]:
        """POST /api/v1/dataset/upload -- create a new dataset from a file."""
        with _tracer.start_as_current_span("dataset.create_from_file"):
            with open(file_path, "rb") as f:
                response = self._http().post(
                    "/api/v1/dataset/upload",
                    data={"name": name},
                    files={"file": (os.path.basename(file_path), f)},
                )
            _raise_for_api_status(
                response, operation="create_from_file"
            )
            return response.json()
