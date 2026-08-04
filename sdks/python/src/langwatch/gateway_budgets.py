"""
API facade for gateway budgets: the caps across all seven scope types,
the attributed-user templates, the ``manual`` window, and period resets.

These routes live on the project-scoped provisioning surface: an
organization API key (``sk-lw-...``) authorizes and ``project_id`` (or
``LANGWATCH_PROJECT_ID``) says which project the objects live under;
project keys self-scope and need no project id. Uses httpx via the
generated REST API client for HTTP transport.
"""

import os
from typing import Any, Callable, Dict, Iterator, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.gateway_http import (
    idempotency_headers,
    note_idempotent_replay,
    quote_path_segment,
    raise_for_status,
    walk_cursor_pages,
)
from langwatch.utils.initialization import ensure_setup


class GatewayBudgetsFacade:
    """Facade for the gateway's spend budgets."""

    def __init__(
        self,
        rest_api_client: LangWatchRestApiClient,
        project_id: Optional[str] = None,
    ) -> None:
        self._client = rest_api_client
        self._project_id = project_id or os.environ.get("LANGWATCH_PROJECT_ID")

    @classmethod
    def from_global(cls) -> "GatewayBudgetsFacade":
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
        self,
        *,
        scope_types: Optional[List[str]] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        external_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """One page of non-archived budgets with live spend, as
        {data, spend_available, next_cursor}.

        ``spend_available: false`` means spend could not be totalled, and
        every ``spent_usd`` on the page is null rather than a stale figure a
        caller could read as real money."""
        params: Dict[str, Any] = {}
        if scope_types:
            params["scope_type"] = ",".join(scope_types)
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        if external_id is not None:
            params["external_id"] = external_id
        response = self._http().get(
            "/api/gateway/v1/budgets", params=params, headers=self._headers()
        )
        raise_for_status(response, operation="list budgets")
        return response.json()

    def list(
        self, *, external_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Every budget across scopes with live spend, following the cursor
        to exhaustion.

        The route pages at a server default of 50, so reading a single page
        would silently truncate any organization holding more budgets than
        that.

        A plain list, like every other exhaustive ``list()``: a walk that ran
        to the end has no cursor left to report, and the page envelope's
        ``spend_available`` is readable off the rows themselves, since a page
        that could not total spend serves ``spent_usd`` and ``spent_nano_usd``
        as null rather than a stale figure. ``any(b["spent_usd"] is None for b
        in budgets)`` is the same answer. Use ``list_page()`` when you want the
        flag stated outright."""
        rows: List[Dict[str, Any]] = []
        for page in walk_cursor_pages(
            lambda cursor: self.list_page(cursor=cursor, external_id=external_id)
        ):
            rows.extend(page["data"])
        return rows

    def iterate(
        self,
        *,
        scope_types: Optional[List[str]] = None,
        limit: Optional[int] = None,
        external_id: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Every budget, one row at a time, fetching a page only when the
        previous one runs out.

        A null ``spent_usd`` means spend could not be totalled rather than
        that nothing was spent."""
        for page in walk_cursor_pages(
            lambda cursor: self.list_page(
                scope_types=scope_types,
                cursor=cursor,
                limit=limit,
                external_id=external_id,
            )
        ):
            yield from page["data"]

    def get(self, budget_id: str) -> Dict[str, Any]:
        """One budget by id, in the row shape the listing returns. Archived
        budgets are not served."""
        response = self._http().get(
            f"/api/gateway/v1/budgets/{quote_path_segment(budget_id)}",
            headers=self._headers(),
        )
        raise_for_status(response, operation="get budget")
        return response.json()["budget"]

    def create(
        self,
        *,
        scope: Dict[str, Any],
        name: str,
        window: str,
        limit_usd: str,
        on_breach: str = "block",
        idempotency_key: Optional[str] = None,
        on_idempotent_replay: Optional[Callable[[], None]] = None,
        **fields: Any,
    ) -> Dict[str, Any]:
        """Create a budget. ``scope`` is the discriminated target, e.g.
        {"kind": "virtual_key", "virtual_key_id": vk} or the per-end-user
        template {"kind": "attributed_user", "anchor_virtual_key_id": vk}.
        ``manual`` windows accrue until an explicit reset.

        ``fields`` are passed to the route as they are, which is where the
        rest of the create body goes:

        * ``cycle_anchor_at``, an RFC3339 instant that phases a cyclic window
          off that moment instead of the calendar, so a ``month`` budget
          anchored ``2026-01-17T09:00:00Z`` rolls every 17th at 09:00 UTC. It
          is immutable once set and is refused on the windows that never cycle
          (``total``, ``manual``).
        * ``external_id``, your own identifier for the budget.
        * ``metadata``, up to 40 string labels. An update sends the map WHOLE:
          it replaces the stored one rather than merging, and {} clears it.
        * ``description``, ``timezone``, ``provider_key``.

        ``idempotency_key`` makes the create safe to retry: a dropped
        connection after the write looks exactly like a dropped request, and
        retrying without a key mints a SECOND budget counting the same spend.
        Send the same key again and the server answers with the first
        response. Receipts answer for 24 hours; reusing a key with a different
        body is refused rather than answered wrongly.

        ``on_idempotent_replay`` is called when the answer came from a receipt
        rather than a fresh write."""
        body = {
            "scope": scope,
            "name": name,
            "window": window,
            "limit_usd": limit_usd,
            "on_breach": on_breach,
            **fields,
        }
        response = self._http().post(
            "/api/gateway/v1/budgets",
            json=body,
            headers={**self._headers(), **idempotency_headers(idempotency_key)},
        )
        raise_for_status(response, operation="create budget")
        note_idempotent_replay(response, on_idempotent_replay)
        return response.json()["budget"]

    def update(self, budget_id: str, **fields: Any) -> Dict[str, Any]:
        """Partial update. Scope, window, and cycle_anchor_at are immutable
        after create; an explicit null clears timezone or description."""
        response = self._http().patch(
            f"/api/gateway/v1/budgets/{quote_path_segment(budget_id)}",
            json=fields,
            headers=self._headers(),
        )
        raise_for_status(response, operation="update budget")
        return response.json()["budget"]

    def archive(self, budget_id: str) -> Dict[str, Any]:
        """Retire a budget: the row is marked archived and the budget engine
        stops counting it, while its ledger history stays readable."""
        response = self._http().delete(
            f"/api/gateway/v1/budgets/{quote_path_segment(budget_id)}",
            headers=self._headers(),
        )
        raise_for_status(response, operation="archive budget")
        return response.json()["budget"]

    def reset(
        self,
        budget_id: str,
        *,
        end_user_id: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Move the period boundary to now; recorded spend never mutates.
        With ``end_user_id`` only that end user's bucket boundary moves."""
        path = f"/api/gateway/v1/budgets/{quote_path_segment(budget_id)}/reset"
        if end_user_id is not None:
            path += f"?end_user_id={quote_path_segment(end_user_id)}"
        response = self._http().post(
            path,
            json={"reason": reason} if reason else {},
            headers=self._headers(),
        )
        raise_for_status(response, operation="reset budget")
        return response.json()["budget"]
