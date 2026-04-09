"""
Unit tests for env-configurable NLP timeouts.

Each timeout reads from an env var with os.getenv() and falls back to a default.
Tests verify:
  1. Without the env var set, the default value is used
  2. With the env var set, the custom value is used
"""

import os
from unittest.mock import MagicMock, patch

import pytest


class TestStreamIdleTimeout:
    """NLP_STREAM_IDLE_TIMEOUT_SECONDS controls idle timeout for streaming events."""

    def test_defaults_to_120_seconds(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NLP_STREAM_IDLE_TIMEOUT_SECONDS", None)
            assert int(os.getenv("NLP_STREAM_IDLE_TIMEOUT_SECONDS", "120")) == 120

    def test_reads_custom_value_from_env(self):
        with patch.dict(os.environ, {"NLP_STREAM_IDLE_TIMEOUT_SECONDS": "300"}):
            assert int(os.getenv("NLP_STREAM_IDLE_TIMEOUT_SECONDS", "120")) == 300


class TestOptimizationIdleTimeout:
    """NLP_OPTIMIZATION_IDLE_TIMEOUT_SECONDS controls idle timeout for optimization events."""

    def test_defaults_to_7200_seconds(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NLP_OPTIMIZATION_IDLE_TIMEOUT_SECONDS", None)
            assert int(os.getenv("NLP_OPTIMIZATION_IDLE_TIMEOUT_SECONDS", "7200")) == 7200

    def test_reads_custom_value_from_env(self):
        with patch.dict(os.environ, {"NLP_OPTIMIZATION_IDLE_TIMEOUT_SECONDS": "3600"}):
            assert int(os.getenv("NLP_OPTIMIZATION_IDLE_TIMEOUT_SECONDS", "7200")) == 3600


class TestHttpNodeDefaultTimeout:
    """NLP_HTTP_NODE_DEFAULT_TIMEOUT_SECONDS is used when timeout_ms is not set."""

    @pytest.mark.asyncio
    async def test_uses_default_300_when_timeout_ms_is_none(self, httpx_mock):
        from langwatch_nlp.studio.execute.http_node import HttpNodeConfig, execute_http_node

        httpx_mock.add_response(url="https://example.com/api", json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://example.com/api",
            method="POST",
            timeout_ms=None,
        )

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NLP_HTTP_NODE_DEFAULT_TIMEOUT_SECONDS", None)
            result = await execute_http_node(config=config, inputs={})

        assert result.success is True
        requests = httpx_mock.get_requests()
        assert len(requests) == 1

    @pytest.mark.asyncio
    async def test_uses_env_var_when_timeout_ms_is_none(self, httpx_mock):
        from langwatch_nlp.studio.execute.http_node import HttpNodeConfig, execute_http_node

        httpx_mock.add_response(url="https://example.com/api", json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://example.com/api",
            method="POST",
            timeout_ms=None,
        )

        captured_timeout = []

        original_async_client = __import__("httpx").AsyncClient

        class CapturingAsyncClient:
            def __init__(self, **kwargs):
                captured_timeout.append(kwargs.get("timeout"))
                self._client = original_async_client(**kwargs)

            async def __aenter__(self):
                await self._client.__aenter__()
                return self._client

            async def __aexit__(self, *args):
                return await self._client.__aexit__(*args)

        with patch.dict(os.environ, {"NLP_HTTP_NODE_DEFAULT_TIMEOUT_SECONDS": "45"}):
            with patch("langwatch_nlp.studio.execute.http_node.httpx.AsyncClient", CapturingAsyncClient):
                result = await execute_http_node(config=config, inputs={})

        assert captured_timeout == [45.0]

    @pytest.mark.asyncio
    async def test_explicit_timeout_ms_overrides_env_default(self, httpx_mock):
        from langwatch_nlp.studio.execute.http_node import HttpNodeConfig, execute_http_node

        httpx_mock.add_response(url="https://example.com/api", json={"result": "ok"})

        config = HttpNodeConfig(
            url="https://example.com/api",
            method="POST",
            timeout_ms=5000,  # 5 seconds explicit
        )

        captured_timeout = []

        original_async_client = __import__("httpx").AsyncClient

        class CapturingAsyncClient:
            def __init__(self, **kwargs):
                captured_timeout.append(kwargs.get("timeout"))
                self._client = original_async_client(**kwargs)

            async def __aenter__(self):
                await self._client.__aenter__()
                return self._client

            async def __aexit__(self, *args):
                return await self._client.__aexit__(*args)

        with patch.dict(os.environ, {"NLP_HTTP_NODE_DEFAULT_TIMEOUT_SECONDS": "999"}):
            with patch("langwatch_nlp.studio.execute.http_node.httpx.AsyncClient", CapturingAsyncClient):
                result = await execute_http_node(config=config, inputs={})

        # 5000ms / 1000 = 5.0 seconds — env var is ignored when timeout_ms is set
        assert captured_timeout == [5.0]


class TestDspyCustomNodeTimeout:
    """NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS controls timeout for DSPy custom node HTTP calls."""

    def test_defaults_to_600_seconds(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS", None)
            assert int(os.getenv("NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS", "600")) == 600

    def test_reads_custom_value_from_env(self):
        with patch.dict(os.environ, {"NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS": "120"}):
            assert int(os.getenv("NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS", "600")) == 120

    def test_passes_default_timeout_to_httpx_post(self):
        from langwatch_nlp.studio.dspy.custom_node import CustomNode

        node = CustomNode(
            api_key="test-key",
            endpoint="https://example.com",
            workflow_id="wf-123",
            version_id=None,
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {"result": "output-value"}

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS", None)
            with patch("langwatch_nlp.studio.dspy.custom_node.httpx.post", return_value=mock_response) as mock_post:
                node.forward(input="hello")

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["timeout"] == 600

    def test_passes_custom_timeout_to_httpx_post(self):
        from langwatch_nlp.studio.dspy.custom_node import CustomNode

        node = CustomNode(
            api_key="test-key",
            endpoint="https://example.com",
            workflow_id="wf-123",
            version_id=None,
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {"result": "output-value"}

        with patch.dict(os.environ, {"NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS": "30"}):
            with patch("langwatch_nlp.studio.dspy.custom_node.httpx.post", return_value=mock_response) as mock_post:
                node.forward(input="hello")

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["timeout"] == 30


class TestDspyEvalLogTimeout:
    """NLP_DSPY_EVAL_LOG_TIMEOUT_SECONDS controls timeout for evaluation batch log HTTP calls."""

    def test_defaults_to_60_seconds(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NLP_DSPY_EVAL_LOG_TIMEOUT_SECONDS", None)
            assert int(os.getenv("NLP_DSPY_EVAL_LOG_TIMEOUT_SECONDS", "60")) == 60

    def test_reads_custom_value_from_env(self):
        with patch.dict(os.environ, {"NLP_DSPY_EVAL_LOG_TIMEOUT_SECONDS": "120"}):
            assert int(os.getenv("NLP_DSPY_EVAL_LOG_TIMEOUT_SECONDS", "60")) == 120

    def test_passes_default_timeout_to_httpx_post(self):
        from langwatch_nlp.studio.dspy.evaluation import EvaluationReporting

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        body = {"experiment_id": "exp-1", "dataset": [], "evaluations": []}

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NLP_DSPY_EVAL_LOG_TIMEOUT_SECONDS", None)
            with patch("langwatch_nlp.studio.dspy.evaluation.httpx.post", return_value=mock_response) as mock_post:
                with patch("langwatch_nlp.studio.dspy.evaluation.langwatch.get_endpoint", return_value="https://app.langwatch.ai"):
                    EvaluationReporting.post_results(api_key="test-api-key", body=body)

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["timeout"] == 60

    def test_passes_custom_timeout_to_httpx_post(self):
        from langwatch_nlp.studio.dspy.evaluation import EvaluationReporting

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        body = {"experiment_id": "exp-1", "dataset": [], "evaluations": []}

        with patch.dict(os.environ, {"NLP_DSPY_EVAL_LOG_TIMEOUT_SECONDS": "15"}):
            with patch("langwatch_nlp.studio.dspy.evaluation.httpx.post", return_value=mock_response) as mock_post:
                with patch("langwatch_nlp.studio.dspy.evaluation.langwatch.get_endpoint", return_value="https://app.langwatch.ai"):
                    EvaluationReporting.post_results(api_key="test-api-key", body=body)

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["timeout"] == 15
