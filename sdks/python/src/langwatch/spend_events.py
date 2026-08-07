"""
API facade for the gateway billing reads: per-request spend events,
reconciliation summaries, replay, and end-user spend with the applicable
caps.

There is no eager whole-collection method on spend events or spend
summaries because both are unbounded ledger reads: walk them with
``iterate`` and ``iter_summaries``, or page them deliberately with
``list_page`` and ``summaries_page``.

All routes are organization-anchored: authenticate with an organization
API key (``sk-lw-...``) via ``langwatch.setup``. Uses httpx via the
generated REST API client for HTTP transport.
"""

from typing import Any, Dict, Iterator, Optional

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


class SpendEventsFacade:
    """Facade for spend events and reconciliation."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "SpendEventsFacade":
        """Build the facade on the process-wide LangWatch client, setting it
        up first if nothing has yet."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    # ── spend events (the ledger read) ────────────────────────────────

    def list_page(
        self,
        *,
        from_ms: int,
        to_ms: int,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        virtual_key_id: Optional[str] = None,
        end_user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        model: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """One page of spend event envelopes over the 13-month ledger, as
        {data, next_cursor}: diff by gateway_request_id."""
        params: Dict[str, Any] = {"from": from_ms, "to": to_ms}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        if virtual_key_id is not None:
            params["virtual_key_id"] = virtual_key_id
        if end_user_id is not None:
            params["end_user_id"] = end_user_id
        if project_id is not None:
            params["project_id"] = project_id
        if model is not None:
            params["model"] = model
        if status is not None:
            params["status"] = status
        response = self._http().get("/api/gateway/v1/spend-events", params=params)
        raise_for_status(response, operation="list spend events")
        return response.json()

    def iterate(
        self,
        *,
        from_ms: int,
        to_ms: int,
        limit: Optional[int] = None,
        virtual_key_id: Optional[str] = None,
        end_user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        model: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Every spend event in the window, one envelope at a time, fetching
        a page only when the previous one runs out.

        Lazy on purpose: the window is a ledger range, so collecting it into
        a list first is a memory bound nobody chose."""
        for page in walk_cursor_pages(
            lambda cursor: self.list_page(
                from_ms=from_ms,
                to_ms=to_ms,
                cursor=cursor,
                limit=limit,
                virtual_key_id=virtual_key_id,
                end_user_id=end_user_id,
                project_id=project_id,
                model=model,
                status=status,
            )
        ):
            yield from page["data"]

    def summaries_page(
        self,
        *,
        group_by: str,
        from_ms: int,
        to_ms: int,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        virtual_key_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """One page of reconciliation checksums, as {data, next_cursor}.

        Rollups are paged by group key ascending. Follow next_cursor until
        it comes back null: a full page does not mean the window held
        nothing more, so a reconciler that reads one page under-counts
        every key past the limit.
        group_by: "virtual_key" or "end_user"."""
        params: Dict[str, Any] = {"group_by": group_by, "from": from_ms, "to": to_ms}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        if virtual_key_id is not None:
            params["virtual_key_id"] = virtual_key_id
        if project_id is not None:
            params["project_id"] = project_id
        response = self._http().get("/api/gateway/v1/spend-summaries", params=params)
        raise_for_status(response, operation="spend summaries")
        return response.json()

    def iter_summaries(
        self,
        *,
        group_by: str,
        from_ms: int,
        to_ms: int,
        limit: Optional[int] = None,
        virtual_key_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Every rollup row in the window, walking the cursor for you.

        The whole-window read a reconciler actually wants, so getting the
        totals right does not depend on remembering to page. Each row
        carries event_count, settled_count, the token classes, and integer
        nano-USD cost."""
        for page in walk_cursor_pages(
            lambda cursor: self.summaries_page(
                group_by=group_by,
                from_ms=from_ms,
                to_ms=to_ms,
                cursor=cursor,
                limit=limit,
                virtual_key_id=virtual_key_id,
                project_id=project_id,
            )
        ):
            yield from page["data"]

    def replay(
        self,
        *,
        from_ms: int,
        to_ms: int,
        endpoint_id: str,
    ) -> Dict[str, Any]:
        """Re-deliver a window of spend events to one webhook endpoint.
        Downstream dedup windows are finite; prefer iterate() + diff for old
        ranges."""
        response = self._http().post(
            "/api/gateway/v1/spend-events/replay",
            json={"from": from_ms, "to": to_ms, "endpoint_id": endpoint_id},
        )
        raise_for_status(response, operation="replay spend events")
        return response.json()["data"]

    def end_user_spend(
        self,
        end_user_id: str,
        *,
        window: Optional[str] = None,
        from_ms: Optional[int] = None,
        to_ms: Optional[int] = None,
        virtual_key_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """One end user's usage rollup over the asked window PLUS the
        applicable attributed-user template caps with boundary-aware
        current-period spend: the pair a rebilling platform polls."""
        params: Dict[str, Any] = {}
        if window is not None:
            params["window"] = window
        if from_ms is not None:
            params["from"] = from_ms
        if to_ms is not None:
            params["to"] = to_ms
        if virtual_key_id is not None:
            params["virtual_key_id"] = virtual_key_id
        response = self._http().get(
            f"/api/gateway/v1/end-users/{quote_path_segment(end_user_id)}/spend",
            params=params,
        )
        raise_for_status(response, operation="end-user spend")
        return response.json()["data"]
