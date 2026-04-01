"""
API service layer for LangWatch Dataset operations.

Encapsulates all HTTP calls to dataset endpoints using hand-rolled httpx,
since the generated OpenAPI client only covers a subset of dataset endpoints.

Uses rest_api_client.get_httpx_client() for transport (like the experiment module)
and _raise_for_api_status() for error surfacing.
"""

from typing import Any, Dict, List, Optional

import httpx
from opentelemetry import trace

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)

_tracer = trace.get_tracer(__name__)


def _raise_for_api_status(response: httpx.Response) -> None:
    """
    Map HTTP error status codes to the SDK's error conventions.

    - 400, 404, 409, 422 -> ValueError (client mistakes)
    - 401                 -> RuntimeError (auth)
    - 5xx                 -> RuntimeError (server)

    Extracts the ``message`` or ``error`` field from JSON body when available.
    """
    if response.is_success:
        return

    status = response.status_code
    detail = ""
    try:
        body = response.json()
        detail = body.get("message") or body.get("error") or ""
    except Exception:
        detail = response.text or ""

    if status == 400:
        raise ValueError(f"Bad request: {detail}" if detail else "Bad request")
    if status == 401:
        raise RuntimeError(
            f"Authentication failed: {detail}" if detail else "Authentication failed"
        )
    if status == 404:
        raise ValueError(f"Not found: {detail}" if detail else "Not found")
    if status == 409:
        raise ValueError(f"Conflict: {detail}" if detail else "Conflict")
    if status == 422:
        raise ValueError(
            f"Validation error: {detail}" if detail else "Validation error"
        )
    if status >= 500:
        raise RuntimeError(
            f"Server error ({status}): {detail}"
            if detail
            else f"Server error ({status})"
        )

    # Fallback for any other non-success status
    raise RuntimeError(f"Unexpected status {status}: {detail}")


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
            _raise_for_api_status(response)
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
            _raise_for_api_status(response)
            return response.json()

    def get_dataset(self, slug_or_id: str) -> Dict[str, Any]:
        """GET /api/dataset/{slugOrId} -- get a dataset with its entries."""
        with _tracer.start_as_current_span("dataset.get_dataset") as span:
            span.set_attribute("inputs.slug_or_id", slug_or_id)

            response = self._http().get(f"/api/dataset/{slug_or_id}")
            _raise_for_api_status(response)
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

            response = self._http().patch(f"/api/dataset/{slug_or_id}", json=body)
            _raise_for_api_status(response)
            return response.json()

    def delete_dataset(self, slug_or_id: str) -> None:
        """DELETE /api/dataset/{slugOrId} -- archive a dataset."""
        with _tracer.start_as_current_span("dataset.delete_dataset"):
            response = self._http().delete(f"/api/dataset/{slug_or_id}")
            _raise_for_api_status(response)

    # ── records ─────────────────────────────────────────────────────

    def create_records(
        self,
        slug_or_id: str,
        *,
        entries: List[Dict[str, Any]],
    ) -> None:
        """POST /api/dataset/{slug}/entries -- add records to a dataset."""
        with _tracer.start_as_current_span("dataset.create_records"):
            body: Dict[str, Any] = {"entries": entries}

            response = self._http().post(
                f"/api/dataset/{slug_or_id}/entries", json=body
            )
            _raise_for_api_status(response)

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

            response = self._http().patch(
                f"/api/dataset/{slug_or_id}/records/{record_id}", json=body
            )
            _raise_for_api_status(response)
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

            response = self._http().request(
                "DELETE",
                f"/api/dataset/{slug_or_id}/records",
                json=body,
            )
            _raise_for_api_status(response)
            data = response.json()
            return int(data.get("deletedCount", 0))

    # ── file upload ─────────────────────────────────────────────────

    def upload(
        self,
        slug_or_id: str,
        *,
        file_path: str,
    ) -> Dict[str, Any]:
        """POST /api/dataset/{slugOrId}/upload -- upload a file to an existing dataset."""
        with _tracer.start_as_current_span("dataset.upload"):
            with open(file_path, "rb") as f:
                response = self._http().post(
                    f"/api/dataset/{slug_or_id}/upload",
                    files={"file": (file_path.split("/")[-1], f)},
                )
            _raise_for_api_status(response)
            return response.json()

    def create_dataset_from_file(
        self,
        *,
        name: str,
        file_path: str,
    ) -> Dict[str, Any]:
        """POST /api/dataset/upload -- create a new dataset from a file."""
        with _tracer.start_as_current_span("dataset.create_dataset_from_file"):
            with open(file_path, "rb") as f:
                response = self._http().post(
                    "/api/dataset/upload",
                    data={"name": name},
                    files={"file": (file_path.split("/")[-1], f)},
                )
            _raise_for_api_status(response)
            return response.json()
