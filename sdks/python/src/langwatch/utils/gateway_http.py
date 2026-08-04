"""
Shared HTTP plumbing for the gateway and webhook billing facades: error
mapping, path-segment quoting, and the cursor walk.

One copy of each, because three copies of the error mapper drifted apart
once already and the surface that lost the 402 branch reported a plan
gate as an unexplained failure.
"""

import urllib.parse
from typing import Any, Callable, Dict, Iterator, Optional, Set

import httpx

from langwatch.utils.exceptions import extract_api_error_detail

IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"
"""The request header the control plane deduplicates creates on."""

IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replay"
"""The response header a replayed create carries. Only ever ``"true"``, and
ABSENT rather than false on a first execution, so its presence is the whole
signal."""

MAX_CURSOR_WALK_PAGES = 1000
"""More pages than any real listing has, so passing it is evidence of a
cursor chain that never ends."""


def raise_for_status(response: httpx.Response, *, operation: str = "") -> None:
    """Map a failed gateway or webhook response onto a builtin exception.

    404 and 400/422 are caller mistakes and raise ValueError; everything
    else, including the 402 that says the plan does not carry the surface,
    raises RuntimeError.
    """
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


def idempotency_headers(idempotency_key: Optional[str]) -> Dict[str, str]:
    """The header that makes a create safe to retry, or nothing at all.

    Callers that never pass a key must send no header: the unkeyed path stores
    no receipt and is left exactly as it was.
    """
    return {IDEMPOTENCY_KEY_HEADER: idempotency_key} if idempotency_key else {}


def note_idempotent_replay(
    response: httpx.Response, on_idempotent_replay: Optional[Callable[[], None]]
) -> None:
    """Tell a caller who asked that this answer came from a receipt rather
    than a fresh write, i.e. that this exact create had already succeeded.

    A callback rather than an extra key on the returned dict: the resource is
    identical either way, so nothing about handling it changes, and the
    returned dict is the wire's own envelope, which has no such key.
    """
    if on_idempotent_replay is None:
        return
    if response.headers.get(IDEMPOTENT_REPLAY_HEADER) == "true":
        on_idempotent_replay()


def quote_path_segment(value: str) -> str:
    """Percent-encode a caller-supplied id so it stays one path segment."""
    return urllib.parse.quote(value, safe="")


def walk_cursor_pages(
    fetch_page: Callable[[Optional[str]], Dict[str, Any]],
) -> Iterator[Dict[str, Any]]:
    """Yield every page of a cursor-paged list, in order.

    Whole pages rather than rows, so a caller can fold whatever else rides
    on the page (a ``spend_available`` flag, say) instead of losing it. The
    walk stops only when ``next_cursor`` comes back absent or null: a full
    page does not mean there is more and a short page does not mean there
    is no more, because some routes filter a page after reading it. A
    cursor served twice, or a chain that passes
    ``MAX_CURSOR_WALK_PAGES``, raises RuntimeError rather than looping
    forever or stopping quietly, since a silent stop is the truncation the
    walk exists to prevent.
    """
    served: Set[str] = set()
    cursor: Optional[str] = None
    pages = 0
    while True:
        page = fetch_page(cursor)
        pages += 1
        yield page
        next_cursor = page.get("next_cursor")
        if not next_cursor:
            return
        if next_cursor in served:
            raise RuntimeError(
                "the endpoint served the same page cursor twice, so the walk cannot advance"
            )
        if pages >= MAX_CURSOR_WALK_PAGES:
            raise RuntimeError(
                f"the walk passed {MAX_CURSOR_WALK_PAGES} pages without the cursor coming back null"
            )
        served.add(next_cursor)
        cursor = next_cursor
