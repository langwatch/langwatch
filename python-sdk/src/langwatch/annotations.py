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


def _raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    """Map HTTP error status codes to appropriate exceptions."""
    if response.is_success:
        return

    status = response.status_code
    detail = ""
    try:
        body = response.json()
        detail = body.get("message") or body.get("error") or ""
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

    def list(self) -> Dict[str, Any]:
        """
        List all annotations for the project.

        Returns:
            Dictionary with annotation data.
        """
        response = self._http().get("/api/annotations")
        _raise_for_status(response, operation="list")
        return response.json()

    def get(self, annotation_id: str) -> Dict[str, Any]:
        """
        Retrieve a single annotation by ID.

        Args:
            annotation_id: The annotation ID.

        Returns:
            Dictionary containing the annotation data.
        """
        response = self._http().get(f"/api/annotations/{_quote(annotation_id)}")
        _raise_for_status(response, operation="get")
        return response.json()

    def get_by_trace(self, trace_id: str) -> Dict[str, Any]:
        """
        Retrieve annotations for a specific trace.

        Args:
            trace_id: The trace ID to look up annotations for.

        Returns:
            Dictionary containing the annotation data for the trace.
        """
        response = self._http().get(
            f"/api/annotations/trace/{_quote(trace_id)}"
        )
        _raise_for_status(response, operation="get_by_trace")
        return response.json()

    def create(
        self,
        trace_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new annotation on a trace.

        Args:
            trace_id: The trace ID to annotate.
            params: Dictionary of annotation fields (comment, isThumbsUp, etc.).

        Returns:
            Dictionary containing the created annotation data.
        """
        body = params or {}
        response = self._http().post(
            f"/api/annotations/trace/{_quote(trace_id)}", json=body
        )
        _raise_for_status(response, operation="create")
        return response.json()

    def delete(self, annotation_id: str) -> Dict[str, Any]:
        """
        Delete an annotation.

        Args:
            annotation_id: The annotation ID to delete.

        Returns:
            Dictionary with deletion result.
        """
        response = self._http().delete(
            f"/api/annotations/{_quote(annotation_id)}"
        )
        _raise_for_status(response, operation="delete")
        return response.json()
