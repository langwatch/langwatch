"""Unit coverage for the shared HTTP client: a GET or HEAD follows redirects
with the same method up to five hops and drops credentials when it leaves the
origin, every other method follows only an http to https upgrade of the same
URL with the same method, headers and body, every refused redirect raises
RedirectRefusedError, the generated REST client carries the transport, and no
hand written call builds its own httpx client. The inner transport is
httpx.MockTransport, so the assertions are on the requests that leave the
process.

Spec: specs/python-sdk/http-client-redirects.feature
"""

import asyncio
import http.server
import json
import logging
import re
import socketserver
import threading
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from langwatch.client import Client
from langwatch.http_client import (
    AsyncSchemeUpgradeTransport,
    RedirectRefusedError,
    SchemeUpgradeTransport,
    _reset_upgrade_warning,
    create_async_client,
    create_client,
    scheme_upgrade_target,
)

HTTP_URL = "http://langwatch.test/api/v1/things?page=2"
HTTPS_URL = "https://langwatch.test/api/v1/things?page=2"
OTHER_PATH = "https://langwatch.test/api/v2/things?page=2"
OTHER_HOST = "https://other.test/api/v1/things?page=2"

CREDENTIALS = {
    "Authorization": "Bearer sk-lw-test",
    "X-Auth-Token": "sk-lw-test",
    "X-Project-Id": "project_1",
    "X-Trace": "abc",
}


@pytest.fixture(autouse=True)
def fresh_warning():
    _reset_upgrade_warning()
    yield
    _reset_upgrade_warning()


def redirecting(
    status: int = 301,
    location: str | None = HTTPS_URL,
    after_upgrade: Callable[[httpx.Request], httpx.Response] | None = None,
):
    """A handler that redirects every http request and answers every https
    request with 200 (or `after_upgrade`), plus the requests it saw."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.scheme == "http":
            headers = {} if location is None else {"location": location}
            return httpx.Response(status, headers=headers)
        if after_upgrade is not None:
            return after_upgrade(request)
        return httpx.Response(200, json={"ok": True})

    return handler, seen


def scripted(*responses: httpx.Response):
    """A handler answering each request from the script, in order, plus the
    requests it saw."""
    seen: list[httpx.Request] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return queue.pop(0)

    return handler, seen


def redirect(status: int, location: str) -> httpx.Response:
    return httpx.Response(status, headers={"location": location})


def sync_client(handler) -> httpx.Client:
    return create_client(transport=httpx.MockTransport(handler))


def async_client(handler) -> httpx.AsyncClient:
    return create_async_client(transport=httpx.MockTransport(handler))


# --- The upgrade every method follows ---


# @scenario "follows a redirect that only upgrades http to https"
@pytest.mark.parametrize("status", [301, 302, 307, 308])
@pytest.mark.parametrize("method", ["GET", "POST"])
def test_follows_the_scheme_upgrade_once(status: int, method: str):
    handler, seen = redirecting(status=status)

    with sync_client(handler) as client:
        response = client.request(method, HTTP_URL)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert [str(r.url) for r in seen] == [HTTP_URL, HTTPS_URL]
    assert [r.method for r in seen] == [method, method]


# @scenario "follows a redirect that only upgrades http to https"
@pytest.mark.asyncio
async def test_follows_the_scheme_upgrade_once_async():
    handler, seen = redirecting()

    async with async_client(handler) as client:
        response = await client.get(HTTP_URL)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert [str(r.url) for r in seen] == [HTTP_URL, HTTPS_URL]


# @scenario "follows a redirect that only upgrades http to https"
def test_fragment_and_default_port_do_not_block_the_upgrade():
    request_url = httpx.URL("http://langwatch.test:80/api/v1/things?page=2")

    assert scheme_upgrade_target(request_url, HTTPS_URL + "#top") == httpx.URL(
        HTTPS_URL
    )
    assert scheme_upgrade_target(
        httpx.URL("http://langwatch.test:8080/api"), "https://langwatch.test:8080/api"
    ) == httpx.URL("https://langwatch.test:8080/api")
    assert (
        scheme_upgrade_target(
            httpx.URL("http://langwatch.test:8080/api"), "https://langwatch.test/api"
        )
        is None
    )


# @scenario "replays the same method, headers and body on the upgrade"
def test_replays_method_headers_and_body():
    handler, seen = redirecting(status=307)
    body = {"name": "ACME", "rows": [1, 2, 3]}

    with sync_client(handler) as client:
        response = client.post(
            HTTP_URL,
            headers={"Authorization": "Bearer sk-lw-test", "X-Trace": "abc"},
            json=body,
        )

    assert response.status_code == 200
    first, second = seen
    assert second.method == "POST"
    assert str(second.url) == HTTPS_URL
    assert second.headers["authorization"] == "Bearer sk-lw-test"
    assert second.headers["x-trace"] == "abc"
    assert second.headers["content-type"] == first.headers["content-type"]
    assert second.content == first.content
    assert json.loads(second.content) == body


# @scenario "replays the same method, headers and body on the upgrade"
@pytest.mark.asyncio
async def test_replays_method_headers_and_body_async():
    handler, seen = redirecting(status=308)

    async with async_client(handler) as client:
        await client.put(
            HTTP_URL, headers={"Authorization": "Bearer k"}, content=b"raw"
        )

    first, second = seen
    assert second.method == "PUT"
    assert second.headers["authorization"] == "Bearer k"
    assert second.content == first.content == b"raw"


# @scenario "warns once per process about an http endpoint"
def test_warns_once_per_process(caplog: pytest.LogCaptureFixture):
    handler, _ = redirecting()

    with (
        caplog.at_level(logging.WARNING, logger="langwatch.http_client"),
        sync_client(handler) as client,
    ):
        client.get(HTTP_URL)
        client.post(HTTP_URL, json={})

    warnings = [r for r in caplog.records if r.name == "langwatch.http_client"]
    assert len(warnings) == 1
    assert warnings[0].getMessage() == (
        "LangWatch endpoint http://langwatch.test redirected to https. "
        "Set the endpoint to https://langwatch.test to skip the extra round trip."
    )


# --- What a GET or HEAD follows ---


# @scenario "a GET follows a redirect to another path"
def test_get_follows_another_path():
    handler, seen = scripted(
        redirect(301, OTHER_PATH), httpx.Response(200, json={"moved": True})
    )

    with sync_client(handler) as client:
        response = client.get(HTTPS_URL)

    assert response.json() == {"moved": True}
    assert [str(r.url) for r in seen] == [HTTPS_URL, OTHER_PATH]
    assert [r.method for r in seen] == ["GET", "GET"]


# @scenario "a GET follows a redirect to another path"
def test_get_follows_a_relative_location():
    handler, seen = scripted(redirect(302, "/api/other"), httpx.Response(200))

    with sync_client(handler) as client:
        client.get(HTTPS_URL)

    assert str(seen[1].url) == "https://langwatch.test/api/other"


# @scenario "a GET follows a redirect to another path"
@pytest.mark.asyncio
async def test_get_follows_another_path_async():
    handler, seen = scripted(redirect(301, OTHER_PATH), httpx.Response(200))

    async with async_client(handler) as client:
        response = await client.get(HTTPS_URL)

    assert response.status_code == 200
    assert [str(r.url) for r in seen] == [HTTPS_URL, OTHER_PATH]


# @scenario "a GET follows a chain of redirects up to five hops"
def test_get_follows_five_hops():
    hops = [f"https://langwatch.test/hop/{n}" for n in range(1, 6)]
    handler, seen = scripted(
        *(redirect(301 if i % 2 == 0 else 307, hop) for i, hop in enumerate(hops)),
        httpx.Response(200, text="final"),
    )

    with sync_client(handler) as client:
        response = client.get(HTTPS_URL)

    assert response.text == "final"
    assert [str(r.url) for r in seen] == [HTTPS_URL, *hops]
    assert {r.method for r in seen} == {"GET"}


# @scenario "a GET refuses a sixth hop"
def test_get_refuses_a_sixth_hop():
    hops = [f"https://langwatch.test/hop/{n}" for n in range(1, 7)]
    handler, seen = scripted(
        *(redirect(302 if i == 5 else 301, hop) for i, hop in enumerate(hops)),
        httpx.Response(200),
    )

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTPS_URL)

    assert len(seen) == 6
    assert raised.value.url == hops[4]
    assert raised.value.location == hops[5]
    assert raised.value.status == 302


# @scenario "a GET refuses a sixth hop"
@pytest.mark.asyncio
async def test_get_refuses_a_sixth_hop_async():
    hops = [f"https://langwatch.test/hop/{n}" for n in range(1, 7)]
    handler, seen = scripted(*(redirect(301, hop) for hop in hops), httpx.Response(200))

    async with async_client(handler) as client:
        with pytest.raises(RedirectRefusedError) as raised:
            await client.get(HTTPS_URL)

    assert len(seen) == 6
    assert raised.value.url == hops[4]


# @scenario "a GET keeps its headers on a same origin redirect"
def test_get_keeps_headers_on_the_same_origin():
    handler, seen = scripted(redirect(302, OTHER_PATH), httpx.Response(200))

    with sync_client(handler) as client:
        client.get(HTTPS_URL, headers=CREDENTIALS)

    first, second = seen
    for name in CREDENTIALS:
        assert second.headers[name] == first.headers[name]
    assert second.headers["host"] == "langwatch.test"


# @scenario "a GET keeps its headers on a same origin redirect"
def test_get_keeps_headers_on_the_scheme_upgrade_of_the_same_host(
    caplog: pytest.LogCaptureFixture,
):
    handler, seen = scripted(redirect(301, OTHER_PATH), httpx.Response(200))

    with (
        caplog.at_level(logging.WARNING, logger="langwatch.http_client"),
        sync_client(handler) as client,
    ):
        client.get(HTTP_URL, headers=CREDENTIALS)

    second = seen[1]
    assert second.headers["authorization"] == "Bearer sk-lw-test"
    assert second.headers["x-auth-token"] == "sk-lw-test"
    assert second.headers["x-project-id"] == "project_1"
    assert len([r for r in caplog.records if r.name == "langwatch.http_client"]) == 1


# @scenario "a GET drops credential headers on a cross origin redirect"
def test_get_drops_credentials_on_another_host(caplog: pytest.LogCaptureFixture):
    handler, seen = scripted(redirect(302, OTHER_HOST), httpx.Response(200))

    with (
        caplog.at_level(logging.WARNING, logger="langwatch.http_client"),
        sync_client(handler) as client,
    ):
        client.get(HTTPS_URL, headers=CREDENTIALS)

    second = seen[1]
    assert str(second.url) == OTHER_HOST
    assert "authorization" not in second.headers
    assert "x-auth-token" not in second.headers
    assert "x-project-id" not in second.headers
    assert second.headers["x-trace"] == "abc"
    assert second.headers["host"] == "other.test"
    assert [r for r in caplog.records if r.name == "langwatch.http_client"] == []


# @scenario "a GET drops credential headers on a cross origin redirect"
def test_get_drops_cookie_proxy_auth_and_api_key_on_another_host():
    handler, seen = scripted(redirect(302, OTHER_HOST), httpx.Response(200))

    with sync_client(handler) as client:
        client.get(
            HTTPS_URL,
            headers={
                **CREDENTIALS,
                "Cookie": "session=secret",
                "Proxy-Authorization": "Basic c2VjcmV0",
                "X-Api-Key": "sk-lw-test",
            },
        )

    second = seen[1]
    assert "cookie" not in second.headers
    assert "proxy-authorization" not in second.headers
    assert "x-api-key" not in second.headers
    assert second.headers["x-trace"] == "abc"


# @scenario "a GET drops credential headers on a cross origin redirect"
def test_get_drops_credentials_on_another_port():
    handler, seen = scripted(
        redirect(302, "https://langwatch.test:8443/api/v1/things?page=2"),
        httpx.Response(200),
    )

    with sync_client(handler) as client:
        client.get(HTTPS_URL, headers=CREDENTIALS)

    second = seen[1]
    assert "authorization" not in second.headers
    assert second.headers["host"] == "langwatch.test:8443"


# @scenario "a GET refuses a downgrade from https to http"
def test_get_refuses_a_downgrade():
    handler, seen = scripted(redirect(301, HTTP_URL), httpx.Response(200))

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTPS_URL)

    assert raised.value.url == HTTPS_URL
    assert raised.value.location == HTTP_URL
    assert len(seen) == 1


# @scenario "a GET refuses a downgrade from https to http"
def test_get_refuses_a_downgrade_in_the_middle_of_a_chain():
    plain = "http://langwatch.test/api/plain"
    handler, seen = scripted(
        redirect(301, OTHER_PATH), redirect(301, plain), httpx.Response(200)
    )

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTPS_URL)

    assert raised.value.url == OTHER_PATH
    assert raised.value.location == plain
    assert len(seen) == 2


# @scenario "a GET follows a 303"
def test_get_follows_a_303():
    handler, seen = scripted(redirect(303, OTHER_PATH), httpx.Response(200))

    with sync_client(handler) as client:
        client.get(HTTPS_URL)

    assert [str(r.url) for r in seen] == [HTTPS_URL, OTHER_PATH]
    assert seen[1].method == "GET"


# @scenario "a HEAD follows a redirect like a GET"
def test_head_follows_like_a_get():
    handler, seen = scripted(redirect(301, OTHER_PATH), httpx.Response(200))

    with sync_client(handler) as client:
        response = client.head(HTTPS_URL, headers=CREDENTIALS)

    assert response.status_code == 200
    assert [str(r.url) for r in seen] == [HTTPS_URL, OTHER_PATH]
    assert seen[1].method == "HEAD"
    assert seen[1].headers["authorization"] == "Bearer sk-lw-test"


# --- What every other method refuses ---


# @scenario "a POST refuses a redirect to another host"
def test_post_refuses_another_host():
    handler, seen = redirecting(location=OTHER_HOST)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.post(HTTP_URL, json={})

    error = raised.value
    assert error.url == HTTP_URL
    assert error.location == OTHER_HOST
    assert error.status == 301
    assert str(error) == (
        f"LangWatch refused to follow a redirect from {HTTP_URL} to {OTHER_HOST} "
        "(HTTP 301). Set the endpoint to the final URL."
    )
    assert len(seen) == 1


# @scenario "a POST refuses a redirect to another host"
@pytest.mark.asyncio
async def test_post_refuses_another_host_async():
    handler, seen = redirecting(location=OTHER_HOST)

    async with async_client(handler) as client:
        with pytest.raises(RedirectRefusedError) as raised:
            await client.post(HTTP_URL, json={})

    assert raised.value.status == 301
    assert len(seen) == 1


# @scenario "a POST still refuses a redirect to another path"
@pytest.mark.parametrize(
    "location",
    [
        OTHER_PATH,
        "https://langwatch.test/api/v1/things?page=3",
        "https://langwatch.test/api/v1/things",
    ],
)
def test_post_refuses_a_changed_path_or_query(location: str):
    handler, seen = redirecting(status=308, location=location)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.post(HTTP_URL, json={})

    assert raised.value.location == location
    assert raised.value.status == 308
    assert len(seen) == 1


# @scenario "a POST still refuses a redirect to another path"
@pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE"])
def test_other_methods_refuse_another_path(method: str):
    handler, seen = scripted(redirect(301, OTHER_PATH), httpx.Response(200))

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.request(method, HTTPS_URL)

    assert raised.value.location == OTHER_PATH
    assert len(seen) == 1


# @scenario "a POST refuses a downgrade from https to http"
def test_post_refuses_a_downgrade():
    handler, seen = scripted(redirect(301, HTTP_URL), httpx.Response(200))

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.post(HTTPS_URL, json={})

    assert raised.value.url == HTTPS_URL
    assert raised.value.location == HTTP_URL
    assert len(seen) == 1


# @scenario "a POST refuses a 303"
def test_post_refuses_a_303():
    handler, seen = redirecting(status=303)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.post(HTTP_URL, json={"a": 1})

    assert raised.value.status == 303
    assert raised.value.location == HTTPS_URL
    assert len(seen) == 1


# @scenario "a POST refuses a second redirect after the upgrade"
def test_post_refuses_a_second_redirect():
    handler, seen = redirecting(
        status=307,
        after_upgrade=lambda request: redirect(307, OTHER_PATH),
    )

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.post(HTTP_URL, json={})

    assert raised.value.url == HTTPS_URL
    assert raised.value.location == OTHER_PATH
    assert raised.value.status == 307
    assert len(seen) == 2


# @scenario "refuses a redirect without a location"
@pytest.mark.parametrize("method", ["GET", "POST"])
def test_refuses_a_redirect_without_a_location(method: str):
    handler, seen = redirecting(location=None)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.request(method, HTTP_URL)

    assert raised.value.location is None
    assert raised.value.status == 301
    assert "<no Location header>" in str(raised.value)
    assert len(seen) == 1


# --- Every request goes through the shared client ---


# @scenario "the generated API client uses the shared transport"
def test_generated_client_carries_the_transport():
    Client.reset_for_testing()
    try:
        sdk = Client(
            api_key="sk-lw-test",
            endpoint_url="http://langwatch.test",
            skip_open_telemetry_setup=True,
        )
        rest = sdk.rest_api_client
        sync_http = rest.get_httpx_client()
        async_http = rest.get_async_httpx_client()

        assert isinstance(sync_http._transport, SchemeUpgradeTransport)
        assert isinstance(async_http._transport, AsyncSchemeUpgradeTransport)
        assert sync_http.follow_redirects is False
        assert async_http.follow_redirects is False
        assert str(sync_http.base_url) == "http://langwatch.test"
        assert str(async_http.base_url) == "http://langwatch.test"
        assert sync_http.headers["x-auth-token"] == "sk-lw-test"
        assert async_http.headers["x-auth-token"] == "sk-lw-test"
    finally:
        Client.reset_for_testing()


# --- Environment proxy discovery ---
#
# httpx builds its environment proxy mounts only when it builds the transport
# itself, so the factories must let it construct the client and wrap the
# transports afterwards. These run against real loopback servers: a stub origin
# and a stub proxy, each answering with its own name, so the assertion is on
# which one actually received the request.


def _serve(body: bytes) -> "tuple[socketserver.TCPServer, int]":
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - the BaseHTTPRequestHandler contract
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # the stub keeps the test output quiet
            pass

    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


@pytest.fixture
def origin_and_proxy(monkeypatch: pytest.MonkeyPatch):
    """A loopback origin and a loopback proxy, with HTTP_PROXY pointing at the
    proxy. Yields the origin's URL; the response body names who answered."""
    origin, origin_port = _serve(b"ORIGIN")
    proxy, proxy_port = _serve(b"PROXY")
    monkeypatch.setenv("HTTP_PROXY", f"http://127.0.0.1:{proxy_port}")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)
    try:
        yield f"http://127.0.0.1:{origin_port}/api/v1/things"
    finally:
        origin.shutdown()
        proxy.shutdown()


# @scenario "the client keeps httpx's environment proxy discovery"
def test_create_client_routes_through_the_environment_proxy(origin_and_proxy: str):
    with create_client() as client:
        assert client.get(origin_and_proxy).text == "PROXY"


# @scenario "the client keeps httpx's environment proxy discovery"
def test_create_async_client_routes_through_the_environment_proxy(
    origin_and_proxy: str,
):
    async def call() -> str:
        async with create_async_client() as client:
            return (await client.get(origin_and_proxy)).text

    assert asyncio.run(call()) == "PROXY"


# @scenario "the client keeps httpx's environment proxy discovery"
def test_the_proxy_transport_carries_the_redirect_rule(origin_and_proxy: str):
    with create_client() as client:
        assert client._mounts
        for mounted in client._mounts.values():
            assert isinstance(mounted, SchemeUpgradeTransport)


# @scenario "the client keeps httpx's environment proxy discovery"
def test_no_proxy_sends_the_request_straight_to_the_origin(
    origin_and_proxy: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")

    with create_client() as client:
        assert client.get(origin_and_proxy).text == "ORIGIN"


# @scenario "the client keeps httpx's environment proxy discovery"
def test_trust_env_false_ignores_the_environment_proxy(origin_and_proxy: str):
    with create_client(trust_env=False) as client:
        assert client.get(origin_and_proxy).text == "ORIGIN"


RAW_HTTPX_CALL = re.compile(
    r"\bhttpx\.(Client|AsyncClient|HTTPTransport|AsyncHTTPTransport"
    r"|get|post|put|patch|delete|head|options|request|stream)\("
)


# @scenario "every hand written request uses the shared transport"
def test_no_hand_written_request_builds_its_own_client():
    source_root = Path(__file__).resolve().parents[1] / "src" / "langwatch"
    offenders: list[str] = []
    for path in source_root.rglob("*.py"):
        relative = path.relative_to(source_root).as_posix()
        if relative.startswith("generated/") or relative == "http_client.py":
            continue
        for number, line in enumerate(path.read_text().splitlines(), start=1):
            if RAW_HTTPX_CALL.search(line):
                offenders.append(f"{relative}:{number}: {line.strip()}")

    assert offenders == []
