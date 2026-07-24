"""The _retry_on_transient decorator must treat server 5xx responses as
transient (a deploy rollout can serve a one-off 500), while client 4xx
responses are real answers and surface immediately."""

import httpx

from langwatch.telemetry.tracing import _is_transient_error


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.invalid/api/trace/t/share")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


def test_treats_timeouts_and_connect_errors_as_transient():
    assert _is_transient_error(httpx.ConnectTimeout("timed out"))
    assert _is_transient_error(httpx.ConnectError("connection refused"))


def test_treats_server_errors_as_transient():
    assert _is_transient_error(_status_error(500))
    assert _is_transient_error(_status_error(502))
    assert _is_transient_error(_status_error(503))


def test_surfaces_client_errors_immediately():
    assert not _is_transient_error(_status_error(401))
    assert not _is_transient_error(_status_error(404))
    assert not _is_transient_error(_status_error(422))


def test_surfaces_unrelated_errors_immediately():
    assert not _is_transient_error(ValueError("not http at all"))
