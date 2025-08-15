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
    2. From parsed response object's 'message' attribute or additional_properties
    3. From response body JSON 'error' field
    4. From response body JSON 'message' field

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
    if parsed is not None:
        error_parts: list[str] = []

        # Get error from parsed object
        try:
            error_val = parsed.error
            if isinstance(error_val, str):
                error_parts.append(error_val)
        except AttributeError:
            pass

        # Get message from parsed object or additional_properties
        try:
            message_val = None
            try:
                message_val = parsed.message
            except AttributeError:
                try:
                    additional_props = parsed.additional_properties
                    if isinstance(additional_props, dict):
                        message_val = additional_props.get("message")
                except AttributeError:
                    pass

            if isinstance(message_val, str):
                error_parts.append(message_val)
        except Exception:
            pass

        if error_parts:
            return " - ".join(error_parts)

    # Fallback to body JSON "error" and "message"
    try:
        text = resp.content.decode(errors="ignore")
        data: dict[str, Any] = json.loads(text) if text else {}

        # Collect both error and message fields
        error_parts = []
        error_val = data.get("error")
        if isinstance(error_val, str):
            error_parts.append(error_val)

        message_val = data.get("message")
        if isinstance(message_val, str):
            error_parts.append(message_val)

        if error_parts:
            return " - ".join(error_parts)
    except Exception:
        pass
    return None


def unwrap_response(
    resp: Response[Any], *, ok_type: Type[R], subject: str, op: str
) -> R | None:
    """
    Unwrap API response with proper error handling and type safety.

    Validates response status and returns parsed response data for successful requests.
    Raises appropriate exceptions for error responses with descriptive messages.

    Args:
        resp: The API response object to unwrap
        ok_type: Expected type for successful response (200/201 status)
        subject: Description of the resource being operated on (for error messages)
        op: Description of the operation being performed (for error messages)

    Returns:
        Parsed response data of type R for successful requests (200/201),
        None for 204 No Content responses

    Raises:
        ValueError: For 400 (bad request) and 404 (not found) errors
        RuntimeError: For authentication (401), server (5xx), and unexpected errors

    Note:
        Follows single responsibility principle - only handles response unwrapping.
        Error message extraction is delegated to _extract_error function.
    """
    status = int(resp.status_code)

    # Handle success status codes
    if status == 200:
        if isinstance(resp.parsed, ok_type):
            return resp.parsed  # type: ignore[return-value]
        raise RuntimeError(f"Unexpected 200 payload for prompt {op}")

    if status == 201:
        if isinstance(resp.parsed, ok_type):
            return resp.parsed  # type: ignore[return-value]
        raise RuntimeError(f"Unexpected 201 payload for prompt {op}")

    if status == 204:
        return None

    # Handle error status codes
    msg = _extract_error(resp)
    if status == 404:
        raise ValueError(f"Prompt not found: {subject}")
    if status == 400:
        error_detail = f": {msg}" if msg else ""
        raise ValueError(f"Invalid prompt request{error_detail}")
    if status == 401:
        raise RuntimeError("Authentication error")
    if status >= 500:
        error_detail = f" - {msg}" if msg else ""
        raise RuntimeError(
            f"Server error during prompt {op} (status {status}){error_detail}"
        )

    error_detail = f": {msg}" if msg else ""
    raise RuntimeError(f"Unexpected status {status} during prompt {op}{error_detail}")
