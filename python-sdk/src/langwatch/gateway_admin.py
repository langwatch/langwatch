"""
API facade for gateway provisioning: virtual keys (the tenant boundary)
and gateway budgets, including the attributed-user templates, the ``manual``
window, period resets, and reversible key disable and enable.

These routes live on the project-scoped provisioning surface: an
organization API key (``sk-lw-...``) authorizes and ``project_id`` (or
``LANGWATCH_PROJECT_ID``) says which project the objects live under;
project keys self-scope and need no project id. Uses httpx via the
generated REST API client for HTTP transport.
"""

import os
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
    if status >= 500:
        raise RuntimeError(f"{label}server error ({status})" + (f": {detail}" if detail else ""))
    raise RuntimeError(f"{label}unexpected status {status}" + (f": {detail}" if detail else ""))


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


class GatewayAdminFacade:
    """Facade for virtual keys and gateway budgets."""

    def __init__(
        self,
        rest_api_client: LangWatchRestApiClient,
        project_id: Optional[str] = None,
    ) -> None:
        self._client = rest_api_client
        self._project_id = project_id or os.environ.get("LANGWATCH_PROJECT_ID")

    @classmethod
    def from_global(cls) -> "GatewayAdminFacade":
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

    # ── virtual keys ──────────────────────────────────────────────────

    def list_virtual_keys(self) -> List[Dict[str, Any]]:
        response = self._http().get(
            "/api/gateway/v1/virtual-keys", headers=self._headers()
        )
        _raise_for_status(response, operation="list virtual keys")
        return response.json()["data"]

    def create_virtual_key(
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
        _raise_for_status(response, operation="create virtual key")
        return response.json()

    def disable_virtual_key(
        self, virtual_key_id: str, *, reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """Reversible stop with its own error code on rejected requests."""
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{_quote(virtual_key_id)}/disable",
            json={"reason": reason} if reason else {},
            headers=self._headers(),
        )
        _raise_for_status(response, operation="disable virtual key")
        return response.json()["virtual_key"]

    def enable_virtual_key(self, virtual_key_id: str) -> Dict[str, Any]:
        response = self._http().post(
            f"/api/gateway/v1/virtual-keys/{_quote(virtual_key_id)}/enable",
            headers=self._headers(),
        )
        _raise_for_status(response, operation="enable virtual key")
        return response.json()["virtual_key"]

    # ── budgets ───────────────────────────────────────────────────────

    def list_budgets(self) -> Dict[str, Any]:
        """Every budget across scopes, with live spend figures."""
        response = self._http().get(
            "/api/gateway/v1/budgets", headers=self._headers()
        )
        _raise_for_status(response, operation="list budgets")
        return response.json()

    def create_budget(
        self,
        *,
        scope: Dict[str, Any],
        name: str,
        window: str,
        limit_usd: str,
        on_breach: str = "block",
        **fields: Any,
    ) -> Dict[str, Any]:
        """Create a budget. ``scope`` is the discriminated target, e.g.
        {"kind": "virtual_key", "virtual_key_id": vk} or the per-end-user
        template {"kind": "attributed_user", "anchor_virtual_key_id": vk}.
        ``manual`` windows accrue until an explicit reset. A
        ``cycle_anchor_at`` field (an RFC3339 instant) phases a cyclic window
        off that moment instead of the calendar, and is not valid on
        ``total`` or ``manual``."""
        body = {
            "scope": scope,
            "name": name,
            "window": window,
            "limit_usd": limit_usd,
            "on_breach": on_breach,
            **fields,
        }
        response = self._http().post(
            "/api/gateway/v1/budgets", json=body, headers=self._headers()
        )
        _raise_for_status(response, operation="create budget")
        return response.json()["budget"]

    def reset_budget(
        self,
        budget_id: str,
        *,
        end_user_id: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Move the period boundary to now; recorded spend never mutates.
        With ``end_user_id`` only that end user's bucket boundary moves."""
        path = f"/api/gateway/v1/budgets/{_quote(budget_id)}/reset"
        if end_user_id is not None:
            path += f"?end_user_id={_quote(end_user_id)}"
        response = self._http().post(
            path,
            json={"reason": reason} if reason else {},
            headers=self._headers(),
        )
        _raise_for_status(response, operation="reset budget")
        return response.json()["budget"]
