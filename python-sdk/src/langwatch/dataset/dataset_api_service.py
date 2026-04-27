"""
API service layer for LangWatch Dataset operations.

Encapsulates all HTTP calls to dataset endpoints using hand-rolled httpx,
since the generated OpenAPI client only covers a subset of dataset endpoints.

Uses rest_api_client.get_httpx_client() for transport (like the experiment module)
and _raise_for_api_status() for error surfacing.
"""

import os
import urllib.parse
from typing import Any, Dict, List, Optional

import httpx
from opentelemetry import trace

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from .errors import DatasetApiError, DatasetNotFoundError, DatasetPlanLimitError

_tracer = trace.get_tracer(__name__)


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
        detail = body.get("message") or body.get("error") or ""
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
        """GET /api/dataset -- list datasets for the project."""
        with _tracer.start_as_current_span("dataset.list_datasets"):
            params: Dict[str, Any] = {}
            if page is not None:
                params["page"] = page
            if limit is not None:
                params["limit"] = limit

            response = self._http().get("/api/dataset", params=params)
            _raise_for_api_status(response, operation="list_datasets")
            return response.json()

    def create_dataset(
        self,
        *,
        name: str,
        columns: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """POST /api/dataset -- create a new dataset."""
        with _tracer.start_as_current_span("dataset.create_dataset"):
            body: Dict[str, Any] = {"name": name}
            if columns is not None:
                body["columnTypes"] = columns

            response = self._http().post("/api/dataset", json=body)
            _raise_for_api_status(response, operation="create_dataset")
            return response.json()

    def get_dataset(
        self,
        slug_or_id: str,
        *,
        tracer: Optional[trace.Tracer] = None,
    ) -> Dict[str, Any]:
        """GET /api/dataset/{slugOrId} -- get a dataset with its entries."""
        active_tracer = tracer or _tracer
        with active_tracer.start_as_current_span("dataset.get_dataset") as span:
            span.set_attribute("inputs.slug_or_id", slug_or_id)

            quoted = self._quote(slug_or_id)
            response = self._http().get(f"/api/dataset/{quoted}")
            _raise_for_api_status(response, operation="get_dataset")
            return response.json()

    def update_dataset(
        self,
        slug_or_id: str,
        *,
        name: Optional[str] = None,
        columns: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """PATCH /api/dataset/{slugOrId} -- update dataset metadata."""
        with _tracer.start_as_current_span("dataset.update_dataset"):
            body: Dict[str, Any] = {}
            if name is not None:
                body["name"] = name
            if columns is not None:
                body["columnTypes"] = columns

            quoted = self._quote(slug_or_id)
            response = self._http().patch(f"/api/dataset/{quoted}", json=body)
            _raise_for_api_status(response, operation="update_dataset")
            return response.json()

    def delete_dataset(self, slug_or_id: str) -> None:
        """DELETE /api/dataset/{slugOrId} -- archive a dataset."""
        with _tracer.start_as_current_span("dataset.delete_dataset"):
            quoted = self._quote(slug_or_id)
            response = self._http().delete(f"/api/dataset/{quoted}")
            _raise_for_api_status(response, operation="delete_dataset")

    # ── records ─────────────────────────────────────────────────────

    def list_records(
        self,
        slug_or_id: str,
        *,
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """GET /api/dataset/{slugOrId}/records -- list records with pagination."""
        with _tracer.start_as_current_span("dataset.list_records"):
            params: Dict[str, Any] = {}
            if page is not None:
                params["page"] = page
            if limit is not None:
                params["limit"] = limit

            quoted = self._quote(slug_or_id)
            response = self._http().get(
                f"/api/dataset/{quoted}/records", params=params
            )
            _raise_for_api_status(response, operation="list_records")
            return response.json()

    def create_records(
        self,
        slug_or_id: str,
        *,
        entries: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """POST /api/dataset/{slugOrId}/records -- batch-create records.

        Returns:
            List of created record dicts, each containing id, entry, and createdAt.
        """
        with _tracer.start_as_current_span("dataset.create_records"):
            body: Dict[str, Any] = {"entries": entries}

            quoted = self._quote(slug_or_id)
            response = self._http().post(
                f"/api/dataset/{quoted}/records", json=body
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
        """PATCH /api/dataset/{slugOrId}/records/{recordId} -- update a single record."""
        with _tracer.start_as_current_span("dataset.update_record"):
            body: Dict[str, Any] = {"entry": entry}

            quoted_slug = self._quote(slug_or_id)
            quoted_record = self._quote(record_id)
            response = self._http().patch(
                f"/api/dataset/{quoted_slug}/records/{quoted_record}", json=body
            )
            _raise_for_api_status(response, operation="update_record")
            return response.json()

    def delete_records(
        self,
        slug_or_id: str,
        *,
        record_ids: List[str],
    ) -> int:
        """DELETE /api/dataset/{slugOrId}/records -- batch-delete records.

        Returns:
            The number of records deleted.
        """
        with _tracer.start_as_current_span("dataset.delete_records"):
            body: Dict[str, Any] = {"recordIds": record_ids}

            quoted = self._quote(slug_or_id)
            response = self._http().request(
                "DELETE",
                f"/api/dataset/{quoted}/records",
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
        """POST /api/dataset/{slugOrId}/upload -- upload a file to an existing dataset."""
        with _tracer.start_as_current_span("dataset.upload_to_existing"):
            quoted = self._quote(slug_or_id)
            with open(file_path, "rb") as f:
                response = self._http().post(
                    f"/api/dataset/{quoted}/upload",
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
        """POST /api/dataset/upload -- create a new dataset from a file."""
        with _tracer.start_as_current_span("dataset.create_from_file"):
            with open(file_path, "rb") as f:
                response = self._http().post(
                    "/api/dataset/upload",
                    data={"name": name},
                    files={"file": (os.path.basename(file_path), f)},
                )
            _raise_for_api_status(
                response, operation="create_from_file"
            )
            return response.json()
