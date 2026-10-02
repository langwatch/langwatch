"""
API facade for managing LangWatch annotations via REST API.

Provides list, get, get_by_trace, create, and delete operations for annotations
with proper error handling.
Uses httpx via the generated REST API client for HTTP transport.
"""

import urllib.parse
from typing import Any, Dict, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from langwatch.utils.exceptions import extract_api_error_detail


def _raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    """Map HTTP error status codes to appropriate exceptions."""
    if response.is_success:
        return

    status = response.status_code
    detail = ""
    try:
        body = response.json()
        detail = extract_api_error_detail(body)
    except Exception:
        detail = response.text or ""

    if status == 404:
        raise ValueError(
            f"Annotation not found: {detail}" if detail else "Annotation not found"
        )
    if status == 400:
        raise ValueError(f"Bad request: {detail}" if detail else "Bad request")
    if status == 401:
        raise RuntimeError(
            f"Authentication failed: {detail}"
            if detail
            else "Authentication failed"
        )
    if status >= 500:
        raise RuntimeError(
            f"Server error ({status}): {detail}"
            if detail
            else f"Server error ({status})"
        )
    raise RuntimeError(f"Unexpected status {status}: {detail}")


def _quote(value: str) -> str:
    """URL-quote a path segment."""
    return urllib.parse.quote(value, safe="")


class AnnotationsFacade:
    """
    Facade for managing LangWatch annotations via REST API.

    Provides list, get, get_by_trace, create, and delete operations.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "AnnotationsFacade":
        """Create an AnnotationsFacade using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def list(self) -> List[Dict[str, Any]]:
        """
        List all annotations for the project.

        Returns:
            List of annotations, empty when the project has none.
        """
        response = self._http().get("/api/annotations")
        _raise_for_status(response, operation="list")
        return response.json()["data"]

    def get(self, annotation_id: str) -> Dict[str, Any]:
        """
        Retrieve a single annotation by ID.

        Args:
            annotation_id: The annotation ID.

        Returns:
            The annotation.
        """
        response = self._http().get(f"/api/annotations/{_quote(annotation_id)}")
        _raise_for_status(response, operation="get")
        return response.json()["data"]

    def get_by_trace(self, trace_id: str) -> List[Dict[str, Any]]:
        """
        Retrieve annotations for a specific trace.

        Args:
            trace_id: The trace ID to look up annotations for.

        Returns:
            List of the trace's annotations, empty when it has none.
        """
        response = self._http().get(
            f"/api/annotations/trace/{_quote(trace_id)}"
        )
        _raise_for_status(response, operation="get_by_trace")
        return response.json()["data"]

    def create(
        self,
        trace_id: str,
        *,
        comment: Optional[str] = None,
        is_thumbs_up: Optional[bool] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new annotation on a trace.

        Both ``comment`` and ``is_thumbs_up`` are mandatory: the route refuses
        a body missing either. They are checked here so a caller learns which
        field is missing without spending a round trip on a 400, and they are
        keyword arguments rather than dictionary keys so the requirement is
        visible at the call site. Either may still arrive through ``params``
        under its wire name, which is how callers supplied them before this
        signature existed.

        Args:
            trace_id: The trace ID to annotate.
            comment: What the reviewer said about the trace.
            is_thumbs_up: The reviewer's verdict on the trace.
            params: Any further annotation fields, under their wire names.

        Returns:
            The created annotation.
        """
        body: Dict[str, Any] = dict(params or {})
        if comment is not None:
            body["comment"] = comment
        if is_thumbs_up is not None:
            body["isThumbsUp"] = is_thumbs_up

        if not body.get("comment") or not isinstance(body["comment"], str):
            raise ValueError(
                "comment is required and must be a non-empty string."
            )
        if not isinstance(body.get("isThumbsUp"), bool):
            raise ValueError("is_thumbs_up is required and must be a boolean.")

        response = self._http().post(
            f"/api/annotations/trace/{_quote(trace_id)}", json=body
        )
        _raise_for_status(response, operation="create")
        return response.json()["data"]

    def delete(self, annotation_id: str) -> Dict[str, Any]:
        """
        Delete an annotation.

        Args:
            annotation_id: The annotation ID to delete.

        Returns:
            The route's ``{status, message}`` acknowledgement. Alone among
            these methods the delete carries no ``data`` key, so there is
            nothing here to unwrap.
        """
        response = self._http().delete(
            f"/api/annotations/{_quote(annotation_id)}"
        )
        _raise_for_status(response, operation="delete")
        return response.json()
