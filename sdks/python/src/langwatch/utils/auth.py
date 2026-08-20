"""Authentication header assembly for the LangWatch Python SDK.

Supports three token families that share the same HTTP surface:

1. ``sk-lw-<48 chars>`` — legacy project API keys. The token itself carries
   the project identity, so we emit both ``Authorization: Bearer <token>``
   and ``X-Auth-Token: <token>`` for backwards compatibility with older
   endpoints that only read the legacy header. A supplied ``project_id`` is
   ignored by the server for these, so we do not send one.

2. ``sk-lw-<16 chars>_<48 chars>`` and ``ik-lw-*`` — new-format API keys and
   ingestion keys. These carry no project, so we add ``X-Project-Id`` whenever
   a project is configured. Without it the server can only infer a project
   when the key holds exactly one project-scoped role binding, and refuses the
   request otherwise. The two ``sk-lw-*`` families are told apart by body
   shape, not by the presence of an underscore — see ``requires_project_header``.

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
from typing import Dict, Optional

PAT_PREFIX = "pat-lw-"
API_KEY_PREFIX = "sk-lw-"
INGEST_KEY_PREFIX = "ik-lw-"

# Mirrors the server's strict new-format body shape:
# {16-char lookupId}_{48-char secret}, both from an alphanumeric alphabet
# (see `getTokenType` in platform/app/src/server/api-key/api-key-token.utils.ts).
# Legacy project keys were minted from alphabets that include `_` and `-`, so
# the mere presence of an underscore does not identify a new-format key.
_NEW_FORMAT_BODY_RE = re.compile(r"^[0-9A-Za-z]{16}_[0-9A-Za-z]{48}$")


def is_personal_access_token(token: str) -> bool:
    """Returns ``True`` when ``token`` looks like a Personal Access Token."""
    return bool(token) and token.startswith(PAT_PREFIX)


def requires_project_header(token: str) -> bool:
    """Returns ``True`` when ``token`` cannot identify its own project.

    New-format API keys (``sk-lw-{16}_{48}``) and ingestion keys (``ik-lw-*``)
    live in the ``ApiKey`` table and carry no project. The server infers one
    only when the key holds exactly one project-scoped role binding; keys
    scoped at organization or team level stay ambiguous and are rejected
    unless the request names a project.

    PATs also need a project, but carry it via Basic auth rather than the
    ``X-Project-Id`` header, so they are excluded here.
    """
    if not token:
        return False
    if token.startswith(INGEST_KEY_PREFIX):
        return True
    if token.startswith(API_KEY_PREFIX):
        return bool(_NEW_FORMAT_BODY_RE.match(token[len(API_KEY_PREFIX) :]))
    return False


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

    # Every non-PAT key (legacy sk-lw-*, new-format sk-lw-*, ik-lw-*) keeps the
    # dual-header shape for callers that read either header.
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Auth-Token": api_key,
    }

    # New-format sk-lw-* and ik-lw-* keys carry no project of their own, so the
    # request has to name one. Legacy keys are left untouched: the server
    # resolves them from the token alone and ignores a supplied project.
    if resolved_project_id and requires_project_header(api_key):
        headers["X-Project-Id"] = resolved_project_id

    return headers
