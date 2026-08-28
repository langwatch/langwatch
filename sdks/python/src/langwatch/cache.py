"""
The agent cache: a per-project store an agent puts its own run state into.

An agent that logs in, or pays for a handle, does that work once per row,
because rows are isolated. This facade gives it one place to keep the result,
so the rows that follow read it instead of repeating the work.

Values are encrypted at rest, expire on their own, and belong to one project.
"""

import urllib.parse
from typing import Any, Dict, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.exceptions import extract_api_error_code
from langwatch.utils.initialization import ensure_setup


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _error_code(response: httpx.Response) -> str:
    try:
        return extract_api_error_code(response.json()) or ""
    except Exception:
        return ""


def _raise_for_status(response: httpx.Response) -> None:
    """Raise for a refused call, naming the status and the platform's code.

    Nothing from the request reaches the message. A cache value is a
    credential often enough that quoting one in an exception, which a run then
    prints, would be the way it leaks.
    """
    if response.is_success:
        return

    status = response.status_code
    code = _error_code(response)
    detail = f" ({code})" if code else ""
    if status in (400, 404):
        raise ValueError(f"The agent cache refused the call: {status}{detail}")
    if status in (401, 403):
        raise RuntimeError(f"The agent cache refused the credential: {status}{detail}")
    raise RuntimeError(f"The agent cache answered {status}{detail}")


class CacheFacade:
    """Read and write the project's agent cache."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "CacheFacade":
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def get(self, name: str, default: Optional[str] = None) -> Optional[str]:
        """
        Read an entry, or `default` when the project holds none under `name`.

        A name that was never stored and one whose lifetime has passed answer
        the same way, so the calling code has one branch rather than a
        try/except around every read.

        Args:
            name: Entry name (UPPER_SNAKE_CASE).
            default: What to answer when there is no live entry.
        """
        response = self._http().get(f"/api/agent-cache/{_quote(name)}")
        if response.status_code == 404:
            return default
        _raise_for_status(response)
        return response.json()["value"]

    def set(
        self, name: str, value: str, ttl_seconds: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Store a value under a name, whether or not the name is held yet.

        Args:
            name: Entry name (UPPER_SNAKE_CASE).
            value: What to store. It is encrypted server-side.
            ttl_seconds: How long the entry stays readable. The project's
                default applies when this is not given.
        """
        body: Dict[str, Any] = {"value": value}
        if ttl_seconds is not None:
            body["ttl_seconds"] = ttl_seconds

        response = self._http().put(f"/api/agent-cache/{_quote(name)}", json=body)
        _raise_for_status(response)
        return response.json()

    def claim(self, name: str, value: str, ttl_seconds: Optional[int] = None) -> bool:
        """
        Take a name, but only if the project does not hold it yet.

        Answers True when this call stored the value, and False when the name
        was already held, which leaves the held value alone. Losing is an
        ordinary answer rather than a refusal, so the calling code reads a
        boolean instead of catching an exception.

        Rows that start together all read an empty cache and all do the work
        the entry was meant to save. This is how one row does that work while
        the rows beside it wait and then read what it stored.

        Args:
            name: Entry name (UPPER_SNAKE_CASE).
            value: What to store. It is encrypted server-side.
            ttl_seconds: How long the entry stays readable. The project's
                default applies when this is not given.
        """
        body: Dict[str, Any] = {"value": value}
        if ttl_seconds is not None:
            body["ttl_seconds"] = ttl_seconds

        response = self._http().post(
            f"/api/agent-cache/{_quote(name)}/claim", json=body
        )
        _raise_for_status(response)
        return bool(response.json()["claimed"])

    def delete(self, name: str) -> Dict[str, Any]:
        """Remove an entry. A name the project does not hold is not an error."""
        response = self._http().delete(f"/api/agent-cache/{_quote(name)}")
        _raise_for_status(response)
        return response.json()
