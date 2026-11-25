"""The Python SDK names the API version it is written against on every request."""

from unittest.mock import patch

from langwatch.client import Client
from langwatch.utils.auth import LANGWATCH_API_VERSION, build_request_headers


# @scenario The Python SDK names the API version on every request
def test_request_headers_name_the_api_version() -> None:
    assert LANGWATCH_API_VERSION == "2026-10-26"
    assert build_request_headers(api_key="sk-lw-test")["X-API-Version"] == "2026-10-26"


# @scenario The Python SDK names the API version on every request
def test_rest_api_client_names_the_api_version() -> None:
    Client.reset_for_testing()

    with patch("langwatch.client.OTLPSpanExporter"):
        Client(api_key="test-key")

    assert Client._rest_api_client is not None
    assert Client._rest_api_client._headers["X-API-Version"] == LANGWATCH_API_VERSION
