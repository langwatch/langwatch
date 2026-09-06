"""The one HTTP client for every request the SDK sends to the LangWatch API.

httpx never follows a redirect on its own here. The clients in this module
apply a rule per method to a 301, 302, 303, 307 or 308, one hop at a time,
so httpx picks the transport (a proxy mount, a NO_PROXY exemption, or a
transport the caller mounted) from the URL of every hop.

GET and HEAD follow the redirect with the same method, up to five hops. A hop
that keeps the origin, or only upgrades http to https on the same host and
port, keeps every header; any other hop drops the credential headers and the
auth the client was built with, so httpx does not sign the hop back in.
A hop from https to http and a hop without a Location are refused.

Every other method follows exactly one redirect, and only when the Location is
the same URL with the scheme changed from http to https. That is what an
endpoint set to `http://app.langwatch.ai` answers with, and following it with
the default client would turn a POST into a GET and drop the body. The replay
keeps the method, the headers and the body bytes.

Every refused redirect raises `RedirectRefusedError`, so a misconfigured
endpoint fails where the caller can read it instead of losing the request.

Use `create_client` and `create_async_client` instead of `httpx.Client` and
`httpx.AsyncClient` anywhere the SDK talks to LangWatch.
"""

import logging
import threading
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Every status the rule inspects.
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
# The statuses a method other than GET or HEAD may follow for the upgrade.
UPGRADE_STATUSES = frozenset({301, 302, 307, 308})

# Methods that follow a redirect to any http or https URL.
FOLLOWING_METHODS = frozenset({"GET", "HEAD"})
# The most redirects a GET or HEAD follows before the next one is refused.
MAX_FOLLOW_HOPS = 5
# Headers dropped when a GET or HEAD hop leaves the origin: the three the Fetch
# standard strips on a cross-origin redirect, plus the names LangWatch keys on.
CREDENTIAL_HEADERS = (
    "authorization",
    "cookie",
    "proxy-authorization",
    "x-api-key",
    "x-auth-token",
    "x-project-id",
)

_SCHEME_DEFAULT_PORTS = {"http": 80, "https": 443}


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


def _same_host_and_port(request_url: httpx.URL, target: httpx.URL) -> bool:
    return request_url.host == target.host and _effective_port(
        request_url
    ) == _effective_port(target)


def _is_scheme_upgrade(request_url: httpx.URL, target: httpx.URL) -> bool:
    """Same host and port, with the scheme changed from http to https."""
    return (
        request_url.scheme == "http"
        and target.scheme == "https"
        and _same_host_and_port(request_url, target)
    )


def _same_origin(request_url: httpx.URL, target: httpx.URL) -> bool:
    return request_url.scheme == target.scheme and _same_host_and_port(
        request_url, target
    )


def scheme_upgrade_target(request_url: httpx.URL, location: str) -> httpx.URL | None:
    """The https URL to replay against when `location` is the request URL with
    only its scheme upgraded from http to https, otherwise None."""
    try:
        target = request_url.join(location)
    except httpx.InvalidURL:
        return None
    if not _is_scheme_upgrade(request_url, target):
        return None
    if request_url.raw_path != target.raw_path:
        return None
    return target.copy_with(fragment=None)


def follow_target(request_url: httpx.URL, location: str) -> httpx.URL | None:
    """The URL a GET or HEAD follows to, or None when the hop is refused: a
    target that is not http or https, or a downgrade from https to http."""
    try:
        target = request_url.join(location)
    except httpx.InvalidURL:
        return None
    if target.scheme not in _SCHEME_DEFAULT_PORTS:
        return None
    if request_url.scheme == "https" and target.scheme == "http":
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


def _keeps_credentials(request_url: httpx.URL, target: httpx.URL) -> bool:
    """Whether a hop may carry the caller's credentials: the same origin, or an
    https upgrade of the same host and port."""
    return _same_origin(request_url, target) or _is_scheme_upgrade(request_url, target)


def _follow_headers(request: httpx.Request, target: httpx.URL) -> httpx.Headers:
    """The headers a GET or HEAD hop sends. Credentials survive the same origin
    and an https upgrade of the same host; the Host header follows the target."""
    headers = httpx.Headers(request.headers)
    if _same_origin(request.url, target):
        return headers
    if not _keeps_credentials(request.url, target):
        for name in CREDENTIAL_HEADERS:
            headers.pop(name, None)
    headers["Host"] = target.netloc.decode("ascii")
    return headers


def _plan_follow(
    request: httpx.Request, response: httpx.Response, hops: int
) -> httpx.Request:
    """The next GET or HEAD hop. Raises RedirectRefusedError past the hop
    limit, without a Location, for a downgrade or a target that is not http
    or https."""
    if hops >= MAX_FOLLOW_HOPS:
        raise _refusal(request, response)
    location = response.headers.get("location")
    if location is None:
        raise _refusal(request, response)
    target = follow_target(request.url, location)
    if target is None:
        raise _refusal(request, response)
    return httpx.Request(
        request.method,
        target,
        headers=_follow_headers(request, target),
        extensions=request.extensions,
    )


def _plan_upgrade(
    request: httpx.Request, response: httpx.Response, hops: int
) -> httpx.Request:
    """The one replay for a method other than GET or HEAD. Raises
    RedirectRefusedError for every redirect that is not an http to https
    upgrade of the same URL with a replayable body, and for a second hop."""
    if hops >= 1:
        raise _refusal(request, response)
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


def _plan_next(
    request: httpx.Request, response: httpx.Response, hops: int
) -> httpx.Request:
    """The request to send after a redirect, per the method's rule."""
    if request.method in FOLLOWING_METHODS:
        return _plan_follow(request, response, hops)
    return _plan_upgrade(request, response, hops)


class LangWatchClient(httpx.Client):
    """An `httpx.Client` that applies the redirect rule to every request.

    Redirects are never followed by httpx itself. Each hop goes through
    `httpx.Client.send`, which selects the transport for the hop's own URL, so
    an https replay leaves through the https mount and a hop to another host
    leaves through that host's mount.
    """

    def __init__(self, **httpx_kwargs: Any) -> None:
        super().__init__(**{**httpx_kwargs, "follow_redirects": False})

    def send(
        self,
        request: httpx.Request,
        *,
        stream: bool = False,
        auth: Any = httpx.USE_CLIENT_DEFAULT,
        follow_redirects: Any = httpx.USE_CLIENT_DEFAULT,
    ) -> httpx.Response:
        hop_auth = auth
        response = super().send(
            request, stream=stream, auth=hop_auth, follow_redirects=False
        )
        hops = 0
        while response.status_code in REDIRECT_STATUSES:
            try:
                next_request = _plan_next(request, response, hops)
            finally:
                response.close()
            if not _keeps_credentials(request.url, next_request.url):
                hop_auth = None
            if _is_scheme_upgrade(request.url, next_request.url):
                _warn_once(request.url)
            request = next_request
            hops += 1
            response = super().send(
                request, stream=stream, auth=hop_auth, follow_redirects=False
            )
        return response


class LangWatchAsyncClient(httpx.AsyncClient):
    """An `httpx.AsyncClient` that applies the redirect rule to every request,
    one hop at a time through `httpx.AsyncClient.send`, the same way
    `LangWatchClient` does."""

    def __init__(self, **httpx_kwargs: Any) -> None:
        super().__init__(**{**httpx_kwargs, "follow_redirects": False})

    async def send(
        self,
        request: httpx.Request,
        *,
        stream: bool = False,
        auth: Any = httpx.USE_CLIENT_DEFAULT,
        follow_redirects: Any = httpx.USE_CLIENT_DEFAULT,
    ) -> httpx.Response:
        hop_auth = auth
        response = await super().send(
            request, stream=stream, auth=hop_auth, follow_redirects=False
        )
        hops = 0
        while response.status_code in REDIRECT_STATUSES:
            try:
                next_request = _plan_next(request, response, hops)
            finally:
                await response.aclose()
            if not _keeps_credentials(request.url, next_request.url):
                hop_auth = None
            if _is_scheme_upgrade(request.url, next_request.url):
                _warn_once(request.url)
            request = next_request
            hops += 1
            response = await super().send(
                request, stream=stream, auth=hop_auth, follow_redirects=False
            )
        return response


def create_client(**httpx_kwargs: Any) -> httpx.Client:
    """A `LangWatchClient` for the LangWatch API. Accepts the `httpx.Client`
    keyword arguments (timeout, headers, base_url, transport, mounts, and so
    on) and passes them to httpx unchanged, so environment proxy discovery
    works the stock way."""
    return LangWatchClient(**httpx_kwargs)


def create_async_client(**httpx_kwargs: Any) -> httpx.AsyncClient:
    """A `LangWatchAsyncClient` for the LangWatch API. Accepts the
    `httpx.AsyncClient` keyword arguments and passes them to httpx unchanged."""
    return LangWatchAsyncClient(**httpx_kwargs)
