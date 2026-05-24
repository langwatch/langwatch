"""S3-staged-payload ASGI middleware for langevals.

When the control plane uploads a large request body to S3 and POSTs only
the presigned URL via the ``X-Payload-S3-URL`` header, this middleware
fetches the URL, swaps the body into the ASGI receive channel, and lets
the downstream route handler parse it exactly as if it had been posted
inline.

Designed so route handlers stay schema-only: they never see the header
and never need a separate code path. The trade-off is the middleware
must guard byte size + fetch failures itself, because the route's
Pydantic model only runs after this middleware has put bytes on the
wire.

Why ASGI not BaseHTTPMiddleware: BaseHTTPMiddleware materializes the
entire response and breaks streaming endpoints. A pure ASGI wrapper
around ``receive`` keeps the rest of the request lifecycle intact.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from starlette.types import ASGIApp, Receive, Scope, Send


STAGED_HEADER_NAME = b"x-payload-s3-url"

# Hard cap on bytes the middleware will fetch from a staged URL. Defaults
# to 256 MB so the topic-clustering 180 MB worst-case fits with headroom
# without unbounded RAM growth from a malicious URL. Lambda memory cap is
# 10 GB so we are well under runtime limits.
_DEFAULT_MAX_BYTES = 256 * 1024 * 1024
_FETCH_TIMEOUT_SECONDS = 30.0


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


_MAX_STAGED_BYTES = _env_int("LANGEVALS_STAGED_MAX_BYTES", _DEFAULT_MAX_BYTES)


logger = logging.getLogger("langevals.staged_payload")


class StagedPayloadMiddleware:
    """ASGI middleware that swaps the request body with the contents of a
    presigned URL when ``X-Payload-S3-URL`` is set.

    No-op for requests without the header.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        staged_url = _find_staged_header(scope.get("headers", []))
        if staged_url is None:
            await self.app(scope, receive, send)
            return

        url_host = _safe_host(staged_url)
        started_at = time.perf_counter()
        try:
            body = await _fetch_staged_body(staged_url, _MAX_STAGED_BYTES)
        except _StagedPayloadTooLarge as exc:
            logger.warning(
                "staged payload exceeded max bytes",
                extra={
                    "staged_url_host": url_host,
                    "observed_bytes": exc.observed_bytes,
                    "max_bytes": _MAX_STAGED_BYTES,
                },
            )
            await _send_error(send, 413, "staged payload exceeds langevals fetch cap")
            return
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.error(
                "failed to fetch staged payload",
                extra={
                    "staged_url_host": url_host,
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                    "elapsed_ms": elapsed_ms,
                },
            )
            await _send_error(
                send,
                502,
                f"failed to fetch X-Payload-S3-URL: {type(exc).__name__}",
            )
            return

        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "fetched staged payload",
            extra={
                "staged_url_host": url_host,
                "bytes": len(body),
                "elapsed_ms": elapsed_ms,
            },
        )

        new_scope = _rewrite_scope(scope, body)
        await self.app(new_scope, _body_receiver(body), send)


class _StagedPayloadTooLarge(Exception):
    def __init__(self, observed_bytes: int) -> None:
        super().__init__(f"observed {observed_bytes} bytes")
        self.observed_bytes = observed_bytes


def _find_staged_header(headers: list[tuple[bytes, bytes]]) -> str | None:
    for name, value in headers:
        if name.lower() == STAGED_HEADER_NAME:
            return value.decode("utf-8", errors="replace")
    return None


def _safe_host(url: str) -> str:
    try:
        return urlparse(url).hostname or "<no-host>"
    except Exception:
        return "<invalid-url>"


async def _fetch_staged_body(url: str, max_bytes: int) -> bytes:
    async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT_SECONDS) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            content_length = response.headers.get("Content-Length")
            if content_length is not None:
                try:
                    declared = int(content_length)
                except ValueError:
                    declared = -1
                if declared > max_bytes:
                    raise _StagedPayloadTooLarge(declared)

            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise _StagedPayloadTooLarge(total)
                chunks.append(chunk)
            return b"".join(chunks)


def _rewrite_scope(scope: Scope, body: bytes) -> Scope:
    """Return a new scope with Content-Length matching the swapped body
    and the staging header stripped so it doesn't leak downstream.
    """

    new_headers: list[tuple[bytes, bytes]] = []
    for name, value in scope.get("headers", []):
        lname = name.lower()
        if lname == STAGED_HEADER_NAME:
            continue
        if lname == b"content-length":
            continue
        if lname == b"transfer-encoding":
            continue
        new_headers.append((name, value))
    new_headers.append((b"content-length", str(len(body)).encode("ascii")))
    if not any(name.lower() == b"content-type" for name, _ in new_headers):
        new_headers.append((b"content-type", b"application/json"))

    new_scope = dict(scope)
    new_scope["headers"] = new_headers
    return new_scope


def _body_receiver(body: bytes) -> Receive:
    sent = False

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return receive


async def _send_error(send: Send, status_code: int, message: str) -> None:
    body = (
        b'{"detail":"' + message.encode("utf-8").replace(b'"', b"'") + b'"}'
    )
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body, "more_body": False})
