"""The SDK identifies itself on every request it makes.

The platform attributes traffic by these headers
(specs/observability/traffic-attribution.feature); a request without them is
counted as an anonymous client, not as this SDK.
"""

from unittest.mock import patch

import pytest

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
    assert headers["User-Agent"].startswith("langwatch-sdk-python/")


# @scenario The Python SDK identifies itself on every request
@pytest.mark.asyncio
async def test_direct_evaluator_requests_identify_the_sdk(monkeypatch) -> None:
    import httpx

    import langwatch
    from langwatch.__version__ import __version__
    from langwatch.evaluation import async_evaluate, evaluate

    requests: list[httpx.Request] = []

    def respond(transport, request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": "processed", "score": 1})

    async def async_respond(transport, request: httpx.Request) -> httpx.Response:
        return respond(transport, request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", respond)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", async_respond)
    Client.reset_for_testing()
    try:
        langwatch.setup(
            api_key="test-key",
            endpoint_url="https://example.test",
            skip_open_telemetry_setup=True,
        )
        result = evaluate("langevals/exact_match", data={"output": "yes"})
        async_result = await async_evaluate(
            "langevals/exact_match", data={"output": "yes"}
        )

        assert result.score == async_result.score == 1
        assert len(requests) == 2
        for request in requests:
            assert request.url.path == "/api/evaluations/langevals/exact_match/evaluate"
            assert request.headers["X-Auth-Token"] == "test-key"
            assert request.headers["Authorization"] == "Bearer test-key"
            assert (
                request.headers["X-LangWatch-SDK-Name"] == "langwatch-observability-sdk"
            )
            assert request.headers["X-LangWatch-SDK-Language"] == "python"
            assert request.headers["X-LangWatch-SDK-Version"] == str(__version__)
            assert (
                request.headers["User-Agent"] == f"langwatch-sdk-python/{__version__}"
            )
    finally:
        Client.reset_for_testing()


# @scenario The Python SDK identifies itself on every request
def test_direct_experiment_requests_identify_the_sdk(monkeypatch) -> None:
    import base64

    import httpx

    import langwatch
    from langwatch.__version__ import __version__
    from langwatch.experiment.experiment import Experiment

    requests: list[httpx.Request] = []

    def respond(transport, request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"path": "/experiments/test", "slug": "test"})

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", respond)
    monkeypatch.setenv("LANGWATCH_PROJECT_ID", "project-test")
    Client.reset_for_testing()
    try:
        langwatch.setup(
            api_key="pat-lw-test",
            endpoint_url="https://example.test",
            skip_open_telemetry_setup=True,
        )
        experiment = Experiment("test")
        experiment.init()
        experiment._log_results("pat-lw-test", {"run_id": experiment.run_id})

        assert [request.url.path for request in requests] == [
            "/api/experiment/init",
            "/api/evaluations/batch/log_results",
        ]
        credential = base64.b64encode(b"project-test:pat-lw-test").decode()
        for request in requests:
            assert request.headers["Authorization"] == f"Basic {credential}"
            assert "X-Auth-Token" not in request.headers
            assert (
                request.headers["X-LangWatch-SDK-Name"] == "langwatch-observability-sdk"
            )
            assert request.headers["X-LangWatch-SDK-Language"] == "python"
            assert request.headers["X-LangWatch-SDK-Version"] == str(__version__)
            assert (
                request.headers["User-Agent"] == f"langwatch-sdk-python/{__version__}"
            )
    finally:
        Client.reset_for_testing()
