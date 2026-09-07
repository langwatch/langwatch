"""Unit tests for better_raise_for_status."""

from __future__ import annotations

import httpx
import pytest

from langwatch.utils.exceptions import better_raise_for_status

pytestmark = pytest.mark.unit


def _response(status_code: int, json_body: object | None = None) -> httpx.Response:
    request = httpx.Request("POST", "https://app.langwatch.ai/api/evaluations/batch/log_results")
    if json_body is None:
        return httpx.Response(status_code, request=request)
    return httpx.Response(status_code, json=json_body, request=request)


class TestBetterRaiseForStatus:
    def test_ok_response_does_not_raise(self) -> None:
        better_raise_for_status(_response(200, {"ok": True}))

    def test_error_body_raises_http_status_error_not_type_error(self) -> None:
        # Regression: the default cls is httpx.HTTPStatusError, whose __init__
        # requires keyword-only request/response. Constructing it with only a
        # message used to raise a TypeError that masked the real server error.
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            better_raise_for_status(_response(500, {"error": "model not configured"}))
        assert "500" in str(exc_info.value)
        assert "model not configured" in str(exc_info.value)

    def test_error_body_with_custom_exception_class(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            better_raise_for_status(_response(400, {"error": "bad request"}), cls=ValueError)
        assert "400" in str(exc_info.value)
        assert "bad request" in str(exc_info.value)

    def test_error_status_without_error_field_reraises_original(self) -> None:
        with pytest.raises(httpx.HTTPStatusError):
            better_raise_for_status(_response(503, {"detail": "unavailable"}))

    def test_error_status_with_non_json_body_reraises_original(self) -> None:
        with pytest.raises(httpx.HTTPStatusError):
            better_raise_for_status(_response(502))
