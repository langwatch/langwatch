"""
The agent cache: a per-project store an agent puts its own run state into.

An agent that logs in, or pays for a handle, does that work once per row,
because rows are isolated. This facade gives it one place to keep the result,
so the rows that follow read it instead of repeating the work.

Values are encrypted at rest, expire on their own, and belong to one project.
"""

import json
import urllib.parse
from typing import Any, Dict, List, Optional, Union

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.exceptions import (
    extract_api_error_code,
    extract_api_error_reasons,
)
from langwatch.utils.initialization import ensure_setup

CacheValue = Union[str, Dict[str, Any], List[Any]]
"""What an entry holds: text, or a dict or list of what JSON can carry, which
travels as JSON text."""


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _error_detail(response: httpx.Response) -> str:
    """The platform's code and the fields it named, or an empty string.

    A refused write names the field and what was expected of it, which is the
    one thing the caller needs to fix it. Nothing from the request itself is
    read back: the platform's wording never quotes a value.
    """
    try:
        body = response.json()
    except Exception:
        return ""
    code = extract_api_error_code(body) or ""
    reasons = extract_api_error_reasons(body)
    if code and reasons:
        return f" ({code}: {'; '.join(reasons)})"
    if code:
        return f" ({code})"
    return ""


def _raise_for_status(response: httpx.Response) -> None:
    """Raise for a refused call, naming the status, the platform's code and
    the fields it rejected.

    Nothing from the request reaches the message. A cache value is a
    credential often enough that quoting one in an exception, which a run then
    prints, would be the way it leaks.
    """
    if response.is_success:
        return

    status = response.status_code
    detail = _error_detail(response)
    if status in (400, 404, 422):
        raise ValueError(f"The agent cache refused the call: {status}{detail}")
    if status in (401, 403):
        raise RuntimeError(f"The agent cache refused the credential: {status}{detail}")
    raise RuntimeError(f"The agent cache answered {status}{detail}")


def _encode(value: CacheValue) -> str:
    """The text the platform stores: a str as is, a dict or list as JSON.

    What comes back is what JSON carries, and JSON has fewer types than
    Python: a tuple is stored as an array and reads back as a list, and a key
    that is not a string is stored as one. A member JSON has no type for
    raises a TypeError here, and so do nan and inf, which Python writes as
    NaN and Infinity for the REST callers and the other SDKs to read as
    broken JSON.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, allow_nan=False)
        except ValueError as refused:
            raise TypeError(
                "A cache value must hold what JSON can carry; "
                f"{refused}"
            ) from refused
    raise TypeError(
        "A cache value must be a str, a dict or a list; "
        f"got {type(value).__name__}"
    )


def _decode(text: str) -> CacheValue:
    """The value the caller stored: JSON text of a dict or list comes back
    parsed, any other text comes back as it is.

    The entry holds text and nothing else, so text that is itself a JSON
    object or array cannot be told apart from a dict the SDK stored, and it
    reads back parsed too. Type metadata would tell them apart, but only for
    the entries this SDK wrote: the route, the REST callers and the other
    SDKs all read the same plain text, and an envelope would be unreadable to
    them.
    """
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            parsed = json.loads(text)
        except ValueError:
            return text
        if isinstance(parsed, (dict, list)):
            return parsed
    return text


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

    def get(
        self, name: str, default: Optional[CacheValue] = None
    ) -> Optional[CacheValue]:
        """
        Read an entry, or `default` when the project holds none under `name`.

        A name that was never stored and one whose lifetime has passed answer
        the same way, so the calling code has one branch rather than a
        try/except around every read.

        A dict or list stored through `set` or `claim` comes back parsed.
        Text comes back as it was stored, unless the text is itself a JSON
        object or array: the entry holds text alone, so that reads back
        parsed as well.

        Args:
            name: Entry name (UPPER_SNAKE_CASE).
            default: What to answer when there is no live entry.
        """
        response = self._http().get(f"/api/agent-cache/{_quote(name)}")
        if response.status_code == 404:
            return default
        _raise_for_status(response)
        return _decode(response.json()["value"])

    def set(
        self, name: str, value: CacheValue, ttl_seconds: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Store a value under a name, whether or not the name is held yet.

        Args:
            name: Entry name (UPPER_SNAKE_CASE).
            value: What to store: text, or a dict or list of what JSON can
                carry, which is stored as JSON and comes back parsed. It is
                encrypted server-side.
            ttl_seconds: How long the entry stays readable. The project's
                default applies when this is not given.
        """
        body: Dict[str, Any] = {"value": _encode(value)}
        if ttl_seconds is not None:
            body["ttl_seconds"] = ttl_seconds

        response = self._http().put(f"/api/agent-cache/{_quote(name)}", json=body)
        _raise_for_status(response)
        return response.json()

    def claim(
        self, name: str, value: CacheValue, ttl_seconds: Optional[int] = None
    ) -> bool:
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
            value: What to store: text, or a dict or list of what JSON can
                carry, which is stored as JSON and comes back parsed. It is
                encrypted server-side.
            ttl_seconds: How long the entry stays readable. The project's
                default applies when this is not given.
        """
        body: Dict[str, Any] = {"value": _encode(value)}
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
