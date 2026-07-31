"""
API facade for the gateway billing surfaces: per-request spend events,
reconciliation summaries, replay, end-user spend with applicable caps,
budget period resets, and reversible virtual-key disable and enable.

All routes are organization-anchored: authenticate with an organization
API key (``sk-lw-...``) via ``langwatch.setup``. Uses httpx via the
generated REST API client for HTTP transport.
"""

import urllib.parse
from typing import Any, Dict, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.exceptions import extract_api_error_detail
from langwatch.utils.initialization import ensure_setup


def _raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    if response.is_success:
        return
    status = response.status_code
    detail = ""
    try:
        body = response.json()
        detail = extract_api_error_detail(body)
    except Exception:
        detail = response.text or ""
    label = f"{operation}: " if operation else ""
    if status == 404:
        raise ValueError(f"{label}not found" + (f": {detail}" if detail else ""))
    if status == 400 or status == 422:
        raise ValueError(f"{label}bad request" + (f": {detail}" if detail else ""))
    if status == 401 or status == 403:
        raise RuntimeError(f"{label}authentication failed" + (f": {detail}" if detail else ""))
    if status == 402:
        raise RuntimeError(f"{label}plan does not include this surface" + (f": {detail}" if detail else ""))
    if status >= 500:
        raise RuntimeError(f"{label}server error ({status})" + (f": {detail}" if detail else ""))
    raise RuntimeError(f"{label}unexpected status {status}" + (f": {detail}" if detail else ""))


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


class SpendEventsFacade:
    """Facade for spend events, reconciliation, and the billing controls."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "SpendEventsFacade":
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    # ── spend events (the ledger read) ────────────────────────────────

    def list(
        self,
        *,
        from_ms: int,
        to_ms: int,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        virtual_key_id: Optional[str] = None,
        end_user_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Cursor-paged spend event envelopes over the 13-month ledger.
        Returns {data, next_cursor}: diff by gateway_request_id."""
        params: Dict[str, Any] = {"from": from_ms, "to": to_ms}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        if virtual_key_id is not None:
            params["virtual_key_id"] = virtual_key_id
        if end_user_id is not None:
            params["end_user_id"] = end_user_id
        if status is not None:
            params["status"] = status
        response = self._http().get("/api/gateway/v1/spend-events", params=params)
        _raise_for_status(response, operation="list spend events")
        return response.json()

    def summaries(
        self,
        *,
        group_by: str,
        from_ms: int,
        to_ms: int,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Reconciliation checksums per key: event_count, settled_count,
        token classes, and integer nano-USD cost. Compare a closed
        period's counts and sums first; walk list() only on divergence.
        group_by: "virtual_key" or "end_user"."""
        params: Dict[str, Any] = {"group_by": group_by, "from": from_ms, "to": to_ms}
        if limit is not None:
            params["limit"] = limit
        response = self._http().get("/api/gateway/v1/spend-summaries", params=params)
        _raise_for_status(response, operation="spend summaries")
        return response.json()["data"]

    def replay(
        self,
        *,
        from_ms: int,
        to_ms: int,
        endpoint_id: str,
    ) -> Dict[str, Any]:
        """Re-deliver a window of spend events to one webhook endpoint.
        Downstream dedup windows are finite; prefer list() + diff for old
        ranges."""
        response = self._http().post(
            "/api/gateway/v1/spend-events/replay",
            json={"from": from_ms, "to": to_ms, "endpoint_id": endpoint_id},
        )
        _raise_for_status(response, operation="replay spend events")
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
            f"/api/gateway/v1/end-users/{_quote(end_user_id)}/spend",
            params=params,
        )
        _raise_for_status(response, operation="end-user spend")
        return response.json()["data"]

    # ── period close ──────────────────────────────────────────────────

    def reset_budget(
        self,
        budget_id: str,
        *,
        end_user_id: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Move a budget's period boundary to now. Recorded spend is never
        mutated; with end_user_id only that end user's bucket boundary
        moves (attributed-user templates)."""
        path = f"/api/gateway/v1/budgets/{_quote(budget_id)}/reset"
        if end_user_id is not None:
            path += f"?end_user_id={_quote(end_user_id)}"
        response = self._http().post(
            path, json={"reason": reason} if reason else {}
        )
        _raise_for_status(response, operation="reset budget")
        return response.json()["budget"]

    # ── tenant kill switch ────────────────────────────────────────────

    def disable_virtual_key(
        self, virtual_key_id: str, *, reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """Reversible stop: requests get the distinct virtual_key_disabled
        error until enable; budgets, scopes, key material, and rotation
        grace stay intact."""
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{_quote(virtual_key_id)}/disable",
            json={"reason": reason} if reason else {},
        )
        _raise_for_status(response, operation="disable virtual key")
        return response.json()["virtual_key"]

    def enable_virtual_key(self, virtual_key_id: str) -> Dict[str, Any]:
        """Reverse of disable: the key returns exactly as it was."""
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{_quote(virtual_key_id)}/enable"
        )
        _raise_for_status(response, operation="enable virtual key")
        return response.json()["virtual_key"]
