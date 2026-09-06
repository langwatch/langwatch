"""Unit coverage for the shared HTTP client: an http to https upgrade of the
same URL is followed once with the same method, headers and body, every other
redirect raises RedirectRefusedError, the generated REST client carries the
transport, and no hand written call builds its own httpx client. The inner
transport is httpx.MockTransport, so the assertions are on the requests that
leave the process.

Spec: specs/python-sdk/http-client-redirects.feature
"""

import json
import logging
import re
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


def sync_client(handler) -> httpx.Client:
    return create_client(transport=httpx.MockTransport(handler))


def async_client(handler) -> httpx.AsyncClient:
    return create_async_client(transport=httpx.MockTransport(handler))


# @scenario "follows a redirect that only upgrades http to https"
@pytest.mark.parametrize("status", [301, 302, 307, 308])
def test_follows_the_scheme_upgrade_once(status: int):
    handler, seen = redirecting(status=status)

    with sync_client(handler) as client:
        response = client.get(HTTP_URL)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert [str(r.url) for r in seen] == [HTTP_URL, HTTPS_URL]


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
        client.get(HTTP_URL)

    warnings = [r for r in caplog.records if r.name == "langwatch.http_client"]
    assert len(warnings) == 1
    assert warnings[0].getMessage() == (
        "LangWatch endpoint http://langwatch.test redirected to https. "
        "Set the endpoint to https://langwatch.test to skip the extra round trip."
    )


# @scenario "refuses a redirect to another host"
def test_refuses_another_host():
    other = "https://other.test/api/v1/things?page=2"
    handler, seen = redirecting(location=other)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTP_URL)

    error = raised.value
    assert error.url == HTTP_URL
    assert error.location == other
    assert error.status == 301
    assert str(error) == (
        f"LangWatch refused to follow a redirect from {HTTP_URL} to {other} "
        "(HTTP 301). Set the endpoint to the final URL."
    )
    assert len(seen) == 1


# @scenario "refuses a redirect to another host"
@pytest.mark.asyncio
async def test_refuses_another_host_async():
    handler, seen = redirecting(location="https://other.test/api/v1/things?page=2")

    async with async_client(handler) as client:
        with pytest.raises(RedirectRefusedError) as raised:
            await client.post(HTTP_URL, json={})

    assert raised.value.status == 301
    assert len(seen) == 1


# @scenario "refuses a redirect that changes the path or query"
@pytest.mark.parametrize(
    "location",
    [
        "https://langwatch.test/api/v2/things?page=2",
        "https://langwatch.test/api/v1/things?page=3",
        "https://langwatch.test/api/v1/things",
    ],
)
def test_refuses_a_changed_path_or_query(location: str):
    handler, _ = redirecting(status=308, location=location)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTP_URL)

    assert raised.value.location == location
    assert raised.value.status == 308


# @scenario "refuses a downgrade from https to http"
def test_refuses_a_downgrade():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(301, headers={"location": HTTP_URL})

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTPS_URL)

    assert raised.value.url == HTTPS_URL
    assert raised.value.location == HTTP_URL
    assert len(seen) == 1


# @scenario "refuses a 303"
def test_refuses_a_303():
    handler, seen = redirecting(status=303)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.post(HTTP_URL, json={"a": 1})

    assert raised.value.status == 303
    assert raised.value.location == HTTPS_URL
    assert len(seen) == 1


# @scenario "refuses a second redirect after the upgrade"
def test_refuses_a_second_redirect():
    second_hop = "https://langwatch.test/api/v2/things?page=2"
    handler, seen = redirecting(
        status=307,
        after_upgrade=lambda request: httpx.Response(
            307, headers={"location": second_hop}
        ),
    )

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTP_URL)

    assert raised.value.url == HTTPS_URL
    assert raised.value.location == second_hop
    assert raised.value.status == 307
    assert len(seen) == 2


# @scenario "refuses a redirect without a location"
def test_refuses_a_redirect_without_a_location():
    handler, _ = redirecting(location=None)

    with sync_client(handler) as client, pytest.raises(RedirectRefusedError) as raised:
        client.get(HTTP_URL)

    assert raised.value.location is None
    assert raised.value.status == 301
    assert "<no Location header>" in str(raised.value)


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
