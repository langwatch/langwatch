"""Authentication header assembly for the LangWatch Python SDK.

Supports three token families that share the same HTTP surface:

1. ``sk-lw-*`` — legacy project API keys. The token itself carries the
   project identity, so we emit both ``Authorization: Bearer <token>``
   and ``X-Auth-Token: <token>`` for backwards compatibility with older
   endpoints that only read the legacy header.

2. ``sk-lw-{16}_{48}`` — scoped API keys. These keys do not necessarily
   identify a project, so a configured project is sent in ``X-Project-Id``.

3. ``pat-lw-*`` — Personal Access Tokens. PATs are user-owned and must
   be paired with a ``project_id`` so the server can resolve the correct
   role binding. When a ``project_id`` is available we encode both into a
   single ``Authorization: Basic base64(project_id:token)`` header — the
   canonical PAT carrier understood by every migrated route.
"""

from __future__ import annotations

import base64
import os
import re

PAT_PREFIX = "pat-lw-"
_NEW_API_KEY_PATTERN = re.compile(r"^sk-lw-[0-9A-Za-z]{16}_[0-9A-Za-z]{48}$")


def is_personal_access_token(token: str) -> bool:
    """Returns ``True`` when ``token`` looks like a Personal Access Token."""
    return bool(token) and token.startswith(PAT_PREFIX)


def _is_new_format_api_key(token: str) -> bool:
    """Returns whether ``token`` has the server's scoped API-key shape."""
    return bool(_NEW_API_KEY_PATTERN.fullmatch(token))


def build_auth_headers(
    api_key: str,
    project_id: str | None = None,
) -> dict[str, str]:
    """Build the HTTP headers required to authenticate against the API.

    Args:
        api_key: The API key or PAT. If empty, no auth headers are emitted.
        project_id: Project identifier. Required for PATs to resolve scope.
            Falls back to the ``LANGWATCH_PROJECT_ID`` environment variable.

    Returns:
        Mapping of header name to value. Empty when ``api_key`` is empty.
    """
    if not api_key:
        return {}

    resolved_project_id = project_id or os.environ.get("LANGWATCH_PROJECT_ID")

    if is_personal_access_token(api_key):
        if resolved_project_id:
            credential = f"{resolved_project_id}:{api_key}".encode()
            encoded = base64.b64encode(credential).decode("utf-8")
            return {"Authorization": f"Basic {encoded}"}

        # PAT without a project_id: use Bearer + X-Auth-Token and let the
        # server reject the request. Silent data loss under an unresolvable
        # PAT would be worse than a clean 401.
        return {
            "Authorization": f"Bearer {api_key}",
            "X-Auth-Token": api_key,
        }

    # Preserve the dual-header shape for every sk-lw-* caller. New-format
    # scoped keys additionally need an explicit project unless the server can
    # infer one from exactly one project-scoped role binding.
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Auth-Token": api_key,
    }
    if resolved_project_id and _is_new_format_api_key(api_key):
        headers["X-Project-Id"] = resolved_project_id
    return headers
