# src/langwatch/prompt/errors.py
"""
Error handling utilities for LangWatch prompt API responses.

This module provides utilities for extracting error messages from API responses
and unwrapping responses with proper error handling and type safety.
"""
from typing import Any, Type, TypeVar
from langwatch.generated.langwatch_rest_api_client.types import Response
import json

R = TypeVar("R")


def _extract_error(resp: Response[Any]) -> str | None:
    """
    Extract error message from API response.

    Attempts to extract error message from response in the following order:
    1. From parsed response object's 'error' attribute
    2. From response body JSON 'error' field

    Args:
        resp: The API response object

    Returns:
        Error message string if found, None otherwise

    Note:
        Uses defensive programming - catches all exceptions during extraction
        to avoid masking the original API error with parsing errors.
    """
    # Prefer parsed.error if available
    parsed = resp.parsed
    if parsed is not None and hasattr(parsed, "error"):
        try:
            return getattr(parsed, "error")
        except Exception:
            pass
    # Fallback to body JSON "error"
    try:
        text = resp.content.decode(errors="ignore")
        data: dict[str, Any] = json.loads(text) if text else {}
        val = data.get("error")
        if isinstance(val, str):
            return val
    except Exception:
        pass
    return None


def unwrap_response(
    resp: Response[Any], *, ok_type: Type[R], subject: str, op: str
) -> R:
    """
    Unwrap API response with proper error handling and type safety.

    Validates response status and returns parsed response data for successful requests.
    Raises appropriate exceptions for error responses with descriptive messages.

    Args:
        resp: The API response object to unwrap
        ok_type: Expected type for successful response (200 status)
        subject: Description of the resource being operated on (for error messages)
        op: Description of the operation being performed (for error messages)

    Returns:
        Parsed response data of type R for successful requests

    Raises:
        ValueError: For 400 (bad request) and 404 (not found) errors
        RuntimeError: For authentication (401), server (5xx), and unexpected errors

    Note:
        Follows single responsibility principle - only handles response unwrapping.
        Error message extraction is delegated to _extract_error function.
    """
    status = int(resp.status_code)
    if status == 200:
        if isinstance(resp.parsed, ok_type):
            return resp.parsed  # type: ignore[return-value]
        raise RuntimeError(f"Unexpected 200 payload for prompt {op}")
    msg = _extract_error(resp)
    if status == 404:
        raise ValueError(f"Prompt not found: {subject}")
    if status == 400:
        raise ValueError(f"Invalid prompt request: {msg}")
    if status == 401:
        raise RuntimeError("Authentication error")
    if status >= 500:
        raise RuntimeError(f"Server error during prompt {op}")
    raise RuntimeError(f"Unexpected status {status} during prompt {op}")
