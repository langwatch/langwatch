"""The SDK identifies itself on every request it makes.

The platform attributes traffic by these headers
(specs/observability/traffic-attribution.feature); a request without them is
counted as an anonymous client, not as this SDK.
"""

from unittest.mock import patch

from langwatch.client import Client


# @scenario The Python SDK identifies itself on every request
def test_otlp_exporter_carries_the_sdk_identity_headers() -> None:
    Client.reset_for_testing()

    with patch("langwatch.client.OTLPSpanExporter") as exporter:
        Client(api_key="test-key")

    headers = exporter.call_args.kwargs["headers"]
    assert headers["X-LangWatch-SDK-Name"] == "langwatch-observability-sdk"
    assert headers["X-LangWatch-SDK-Language"] == "python"
    assert headers["X-LangWatch-SDK-Version"]
    assert headers["User-Agent"].startswith("langwatch-sdk-python/")


# @scenario The Python SDK identifies itself on every request
def test_rest_api_client_carries_the_sdk_identity_headers() -> None:
    Client.reset_for_testing()

    with patch("langwatch.client.OTLPSpanExporter"):
        Client(api_key="test-key")

    assert Client._rest_api_client is not None
    headers = Client._rest_api_client._headers
    assert headers["X-LangWatch-SDK-Name"] == "langwatch-observability-sdk"
    assert headers["X-LangWatch-SDK-Language"] == "python"
    assert headers["X-LangWatch-SDK-Version"]
