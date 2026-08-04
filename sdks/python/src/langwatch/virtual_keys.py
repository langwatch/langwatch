"""
API facade for virtual keys, the gateway's tenant boundary: minting and
rotation (each of which hands back a one-time secret), the reversible
disable and enable pair, terminal revoke, and per-key spend.

These routes live on the project-scoped provisioning surface: an
organization API key (``sk-lw-...``) authorizes and ``project_id`` (or
``LANGWATCH_PROJECT_ID``) says which project the objects live under;
project keys self-scope and need no project id. Uses httpx via the
generated REST API client for HTTP transport.
"""

import os
from typing import Any, Dict, Iterator, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.gateway_http import (
    quote_path_segment,
    raise_for_status,
    walk_cursor_pages,
)
from langwatch.utils.initialization import ensure_setup


class VirtualKeysFacade:
    """Facade for the gateway's virtual keys."""

    def __init__(
        self,
        rest_api_client: LangWatchRestApiClient,
        project_id: Optional[str] = None,
    ) -> None:
        self._client = rest_api_client
        self._project_id = project_id or os.environ.get("LANGWATCH_PROJECT_ID")

    @classmethod
    def from_global(cls) -> "VirtualKeysFacade":
        """Build the facade on the process-wide LangWatch client, setting it
        up first if nothing has yet."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def _headers(self) -> Dict[str, str]:
        # Org-anchored API keys carry no project of their own; the surface
        # scopes on this header. Project keys self-scope and ignore it.
        return {"X-Project-Id": self._project_id} if self._project_id else {}

    def list_page(
        self, *, cursor: Optional[str] = None, limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """One page of visible virtual keys, newest first, as
        {data, next_cursor}.

        Neither page length says anything about the walk: the server filters
        each page for visibility after reading it, so a page shorter than
        ``limit`` can still be followed by a full one. Only a null
        ``next_cursor`` means the walk is done."""
        params: Dict[str, Any] = {}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        response = self._http().get(
            "/api/gateway/v1/virtual-keys", params=params, headers=self._headers()
        )
        raise_for_status(response, operation="list virtual keys")
        return response.json()

    def list(self) -> List[Dict[str, Any]]:
        """Every virtual key visible to the caller, following the cursor to
        exhaustion.

        The route pages at a server default of 50, so reading a single page
        would silently truncate any organization holding more keys than
        that."""
        rows: List[Dict[str, Any]] = []
        for page in walk_cursor_pages(lambda cursor: self.list_page(cursor=cursor)):
            rows.extend(page["data"])
        return rows

    def iterate(self, *, limit: Optional[int] = None) -> Iterator[Dict[str, Any]]:
        """Every visible virtual key, one row at a time, fetching a page only
        when the previous one runs out."""
        for page in walk_cursor_pages(
            lambda cursor: self.list_page(cursor=cursor, limit=limit)
        ):
            yield from page["data"]

    def get(self, virtual_key_id: str) -> Dict[str, Any]:
        """One virtual key by id."""
        response = self._http().get(
            f"/api/gateway/v1/virtual-keys/{quote_path_segment(virtual_key_id)}",
            headers=self._headers(),
        )
        raise_for_status(response, operation="get virtual key")
        return response.json()["virtual_key"]

    def create(
        self, *, name: str, description: Optional[str] = None, **fields: Any
    ) -> Dict[str, Any]:
        """Mint a key. The response carries the secret ONCE; the virtual
        key object rides under ``virtual_key``."""
        body: Dict[str, Any] = {"name": name, **fields}
        if description is not None:
            body["description"] = description
        response = self._http().post(
            "/api/gateway/v1/virtual-keys", json=body, headers=self._headers()
        )
        raise_for_status(response, operation="create virtual key")
        return response.json()

    def update(self, virtual_key_id: str, **fields: Any) -> Dict[str, Any]:
        """Partial update: send only the fields to change. ``scopes``
        replaces the whole visibility set, ``config`` is deep-merged, and an
        explicit null ``budget`` archives the key's own cap."""
        response = self._http().patch(
            f"/api/gateway/v1/virtual-keys/{quote_path_segment(virtual_key_id)}",
            json=fields,
            headers=self._headers(),
        )
        raise_for_status(response, operation="update virtual key")
        return response.json()["virtual_key"]

    def rotate(self, virtual_key_id: str) -> Dict[str, Any]:
        """Mint a fresh secret for an existing key, returned ONCE like
        create. The old secret keeps working for a 24h grace window so
        in-flight clients can roll over."""
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{quote_path_segment(virtual_key_id)}/rotate",
            headers=self._headers(),
        )
        raise_for_status(response, operation="rotate virtual key")
        return response.json()

    def revoke(self, virtual_key_id: str) -> Dict[str, Any]:
        """Terminal stop: the key is marked revoked and its own budgets are
        archived. Use disable for anything reversible."""
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{quote_path_segment(virtual_key_id)}/revoke",
            headers=self._headers(),
        )
        raise_for_status(response, operation="revoke virtual key")
        return response.json()["virtual_key"]

    def disable(
        self, virtual_key_id: str, *, reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """Reversible stop: requests get the distinct virtual_key_disabled
        error until enable; budgets, scopes, key material, and rotation
        grace stay intact."""
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{quote_path_segment(virtual_key_id)}/disable",
            json={"reason": reason} if reason else {},
            headers=self._headers(),
        )
        raise_for_status(response, operation="disable virtual key")
        return response.json()["virtual_key"]

    def enable(self, virtual_key_id: str) -> Dict[str, Any]:
        """Reverse of disable: the key returns exactly as it was."""
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{quote_path_segment(virtual_key_id)}/enable",
            headers=self._headers(),
        )
        raise_for_status(response, operation="enable virtual key")
        return response.json()["virtual_key"]

    def spend(
        self,
        virtual_key_id: str,
        *,
        from_ms: Optional[int] = None,
        to_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Aggregate spend and request count for one key over a window in
        epoch milliseconds, defaulting to the current UTC calendar month.
        Reads the same cost path the dashboard reads, so this figure and the
        UI agree by construction."""
        params: Dict[str, Any] = {}
        if from_ms is not None:
            params["from"] = from_ms
        if to_ms is not None:
            params["to"] = to_ms
        response = self._http().get(
            f"/api/gateway/v1/virtual-keys/{quote_path_segment(virtual_key_id)}/spend",
            params=params,
            headers=self._headers(),
        )
        raise_for_status(response, operation="virtual key spend")
        return response.json()
