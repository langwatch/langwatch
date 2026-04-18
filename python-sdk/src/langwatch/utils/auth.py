"""Authentication header assembly for the LangWatch Python SDK.

Supports two token families that share the same HTTP surface:

1. ``sk-lw-*`` — legacy project API keys. The token itself carries the
   project identity, so we emit both ``Authorization: Bearer <token>``
   and ``X-Auth-Token: <token>`` for backwards compatibility with older
   endpoints that only read the legacy header.

2. ``pat-lw-*`` — Personal Access Tokens. PATs are user-owned and must
   be paired with a ``project_id`` so the server can resolve the correct
   role binding. When a ``project_id`` is available we encode both into a
   single ``Authorization: Basic base64(project_id:token)`` header — the
   canonical PAT carrier understood by every migrated route.
"""

from __future__ import annotations

import base64
import os
from typing import Dict, Optional

PAT_PREFIX = "pat-lw-"


def is_personal_access_token(token: str) -> bool:
    """Returns ``True`` when ``token`` looks like a Personal Access Token."""
    return bool(token) and token.startswith(PAT_PREFIX)


def build_auth_headers(
    api_key: str,
    project_id: Optional[str] = None,
) -> Dict[str, str]:
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
            credential = f"{resolved_project_id}:{api_key}".encode("utf-8")
            encoded = base64.b64encode(credential).decode("utf-8")
            return {"Authorization": f"Basic {encoded}"}

        # PAT without a project_id: use Bearer + X-Auth-Token and let the
        # server reject the request. Silent data loss under an unresolvable
        # PAT would be worse than a clean 401.
        return {
            "Authorization": f"Bearer {api_key}",
            "X-Auth-Token": api_key,
        }

    # Legacy sk-lw-* key: preserve dual-header shape for callers that
    # read either header.
    return {
        "Authorization": f"Bearer {api_key}",
        "X-Auth-Token": api_key,
    }
