"""The one HTTP client for every request the SDK sends to the LangWatch API.

httpx never follows a redirect on its own here. The transports in this module
follow exactly one kind: a 301, 302, 307 or 308 whose Location is the same
URL with the scheme changed from http to https. That is what an endpoint set
to `http://app.langwatch.ai` answers with, and following it with the default
client would turn a POST into a GET and drop the body. The replay keeps the
method, the headers and the body bytes. Every other redirect is refused with
`RedirectRefusedError`, so a misconfigured endpoint fails where the caller can
read it instead of losing the request.

Use `create_client` and `create_async_client` instead of `httpx.Client` and
`httpx.AsyncClient` anywhere the SDK talks to LangWatch.
"""

import logging
import threading
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Every status the rule inspects. A 303 is in the set so it is refused with
# the typed error instead of reaching the caller as a bare response.
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
UPGRADE_STATUSES = frozenset({301, 302, 307, 308})

_SCHEME_DEFAULT_PORTS = {"http": 80, "https": 443}

# Keyword arguments that httpx only honours on the transport it builds itself.
# Passing them to a client that already carries a transport does nothing, so
# the factories move them onto the inner transport.
_TRANSPORT_KWARGS = ("verify", "cert", "http1", "http2", "limits", "proxy")


class RedirectRefusedError(Exception):
    """A LangWatch request answered with a redirect the SDK will not follow."""

    def __init__(self, *, url: str, location: str | None, status: int) -> None:
        self.url = url
        self.location = location
        self.status = status
        shown_location = location if location is not None else "<no Location header>"
        super().__init__(
            f"LangWatch refused to follow a redirect from {url} to {shown_location} "
            f"(HTTP {status}). Set the endpoint to the final URL."
        )


_warning_lock = threading.Lock()
_upgrade_warned = False


def _reset_upgrade_warning() -> None:
    """Allow the next upgrade to warn again. For tests."""
    global _upgrade_warned
    with _warning_lock:
        _upgrade_warned = False


def _warn_once(request_url: httpx.URL) -> None:
    global _upgrade_warned
    with _warning_lock:
        if _upgrade_warned:
            return
        _upgrade_warned = True
    netloc = request_url.netloc.decode("ascii")
    logger.warning(
        "LangWatch endpoint %s://%s redirected to https. Set the endpoint to "
        "https://%s to skip the extra round trip.",
        request_url.scheme,
        netloc,
        netloc,
    )


def _effective_port(url: httpx.URL) -> int | None:
    """The port, with the scheme default read as absent so http://host and
    https://host compare equal and http://host:80 equals http://host."""
    if url.port is None or url.port == _SCHEME_DEFAULT_PORTS.get(url.scheme):
        return None
    return url.port


def scheme_upgrade_target(request_url: httpx.URL, location: str) -> httpx.URL | None:
    """The https URL to replay against when `location` is the request URL with
    only its scheme upgraded from http to https, otherwise None."""
    try:
        target = request_url.join(location)
    except httpx.InvalidURL:
        return None
    if request_url.scheme != "http" or target.scheme != "https":
        return None
    if request_url.host != target.host:
        return None
    if _effective_port(request_url) != _effective_port(target):
        return None
    if request_url.raw_path != target.raw_path:
        return None
    return target.copy_with(fragment=None)


def _replayable_body(request: httpx.Request) -> bytes | None:
    try:
        return request.content
    except httpx.RequestNotRead:
        return None


def _refusal(request: httpx.Request, response: httpx.Response) -> RedirectRefusedError:
    return RedirectRefusedError(
        url=str(request.url),
        location=response.headers.get("location"),
        status=response.status_code,
    )


def _plan_replay(
    request: httpx.Request, response: httpx.Response
) -> httpx.Request | None:
    """The request to send once more, or None when the response is not a
    redirect. Raises RedirectRefusedError for every redirect that is not an
    http to https upgrade of the same URL with a replayable body."""
    if response.status_code not in REDIRECT_STATUSES:
        return None
    location = response.headers.get("location")
    if location is None or response.status_code not in UPGRADE_STATUSES:
        raise _refusal(request, response)
    target = scheme_upgrade_target(request.url, location)
    if target is None:
        raise _refusal(request, response)
    body = _replayable_body(request)
    if body is None:
        raise _refusal(request, response)
    return httpx.Request(
        request.method,
        target,
        headers=request.headers,
        content=body,
        extensions=request.extensions,
    )


class SchemeUpgradeTransport(httpx.BaseTransport):
    """Wraps a sync transport and applies the redirect rule to its answers."""

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self.transport: httpx.BaseTransport = transport or httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self.transport.handle_request(request)
        try:
            replay = _plan_replay(request, response)
        finally:
            if response.status_code in REDIRECT_STATUSES:
                response.close()
        if replay is None:
            return response
        _warn_once(request.url)
        upgraded = self.transport.handle_request(replay)
        if upgraded.status_code in REDIRECT_STATUSES:
            upgraded.close()
            raise _refusal(replay, upgraded)
        return upgraded

    def close(self) -> None:
        self.transport.close()


class AsyncSchemeUpgradeTransport(httpx.AsyncBaseTransport):
    """Wraps an async transport and applies the redirect rule to its answers."""

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.transport: httpx.AsyncBaseTransport = (
            transport or httpx.AsyncHTTPTransport()
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.transport.handle_async_request(request)
        try:
            replay = _plan_replay(request, response)
        finally:
            if response.status_code in REDIRECT_STATUSES:
                await response.aclose()
        if replay is None:
            return response
        _warn_once(request.url)
        upgraded = await self.transport.handle_async_request(replay)
        if upgraded.status_code in REDIRECT_STATUSES:
            await upgraded.aclose()
            raise _refusal(replay, upgraded)
        return upgraded

    async def aclose(self) -> None:
        await self.transport.aclose()


def _split_transport_kwargs(httpx_kwargs: dict[str, Any]) -> dict[str, Any]:
    transport_kwargs = {
        key: httpx_kwargs.pop(key) for key in _TRANSPORT_KWARGS if key in httpx_kwargs
    }
    if "trust_env" in httpx_kwargs:
        transport_kwargs["trust_env"] = httpx_kwargs["trust_env"]
    return transport_kwargs


def _wrap_mounts(client: Any, wrapper: type) -> None:
    """Proxy settings read from the environment become extra transports on the
    client. Those must apply the rule too, so they are wrapped in place."""
    mounts = getattr(client, "_mounts", None)
    if not isinstance(mounts, dict):
        return
    for pattern, transport in list(mounts.items()):
        if transport is not None and not isinstance(transport, wrapper):
            mounts[pattern] = wrapper(transport)


def create_client(**httpx_kwargs: Any) -> httpx.Client:
    """An `httpx.Client` for the LangWatch API. Accepts the `httpx.Client`
    keyword arguments (timeout, headers, base_url, and so on); a `transport`
    argument becomes the inner transport."""
    inner = httpx_kwargs.pop("transport", None)
    transport_kwargs = _split_transport_kwargs(httpx_kwargs)
    if inner is None:
        inner = httpx.HTTPTransport(**transport_kwargs)
    client = httpx.Client(
        follow_redirects=False,
        transport=SchemeUpgradeTransport(inner),
        **httpx_kwargs,
    )
    _wrap_mounts(client, SchemeUpgradeTransport)
    return client


def create_async_client(**httpx_kwargs: Any) -> httpx.AsyncClient:
    """An `httpx.AsyncClient` for the LangWatch API. Accepts the
    `httpx.AsyncClient` keyword arguments; a `transport` argument becomes the
    inner transport."""
    inner = httpx_kwargs.pop("transport", None)
    transport_kwargs = _split_transport_kwargs(httpx_kwargs)
    if inner is None:
        inner = httpx.AsyncHTTPTransport(**transport_kwargs)
    client = httpx.AsyncClient(
        follow_redirects=False,
        transport=AsyncSchemeUpgradeTransport(inner),
        **httpx_kwargs,
    )
    _wrap_mounts(client, AsyncSchemeUpgradeTransport)
    return client
