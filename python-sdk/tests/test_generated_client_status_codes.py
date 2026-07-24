"""
Regression tests for non-IANA HTTP status codes in the generated REST client.

Cloudflare (520-527), AWS WAF (561), and other proxies return status codes that
are not in Python's http.HTTPStatus enum. Upstream openapi-python-client blindly
calls HTTPStatus(code) in _build_response, which raises ValueError on those codes.

Tracked upstream: https://github.com/openapi-generators/openapi-python-client/pull/1407
"""

from http import HTTPStatus

import httpx
import pytest

from langwatch.generated.langwatch_rest_api_client import errors
from langwatch.generated.langwatch_rest_api_client.api.default import (
    get_api_prompts_by_id,
)
from langwatch.generated.langwatch_rest_api_client.client import Client
from langwatch.generated.langwatch_rest_api_client.types import safe_http_status

pytestmark = pytest.mark.unit


class TestSafeHttpStatus:
    def test_returns_httpstatus_for_iana_codes(self) -> None:
        assert safe_http_status(200) is HTTPStatus.OK
        assert safe_http_status(404) is HTTPStatus.NOT_FOUND
        assert safe_http_status(500) is HTTPStatus.INTERNAL_SERVER_ERROR

    def test_returns_raw_int_for_cloudflare_codes(self) -> None:
        for code in (520, 521, 522, 523, 524, 525, 526, 527):
            assert safe_http_status(code) == code
            assert not isinstance(safe_http_status(code), HTTPStatus)

    def test_returns_raw_int_for_other_non_iana_codes(self) -> None:
        assert safe_http_status(561) == 561  # AWS WAF
        assert safe_http_status(499) == 499  # nginx client closed request


class TestBuildResponseWithNonStandardStatus:
    def _make_httpx_response(self, status_code: int) -> httpx.Response:
        return httpx.Response(
            status_code=status_code,
            content=b"<html>upstream broken</html>",
            headers={"content-type": "text/html"},
        )

    def test_does_not_crash_on_cloudflare_520(self) -> None:
        """Customer-reported scenario: Cloudflare returns 520 when origin is unreachable."""
        client = Client(base_url="https://example.com", raise_on_unexpected_status=False)
        response = self._make_httpx_response(520)

        built = get_api_prompts_by_id._build_response(client=client, response=response)

        assert built.status_code == 520
        assert built.parsed is None  # no matching response handler for 520

    def test_preserves_httpstatus_for_iana_codes_without_handler(self) -> None:
        """418 is IANA-registered but has no _parse_response handler for this endpoint."""
        client = Client(base_url="https://example.com", raise_on_unexpected_status=False)
        response = self._make_httpx_response(418)

        built = get_api_prompts_by_id._build_response(client=client, response=response)

        assert built.status_code is HTTPStatus.IM_A_TEAPOT
        assert built.parsed is None

    def test_raises_unexpected_status_on_520_when_enabled(self) -> None:
        """raise_on_unexpected_status=True must surface UnexpectedStatus(520), not ValueError."""
        client = Client(base_url="https://example.com", raise_on_unexpected_status=True)
        response = self._make_httpx_response(520)

        with pytest.raises(errors.UnexpectedStatus) as exc_info:
            get_api_prompts_by_id._build_response(client=client, response=response)

        assert exc_info.value.status_code == 520
