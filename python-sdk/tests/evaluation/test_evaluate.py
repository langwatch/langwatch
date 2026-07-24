"""Tests for langwatch.evaluation.evaluate() and async_evaluate() functions."""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import httpx

from langwatch.evaluation import (
    evaluate,
    async_evaluate,
    BasicEvaluateData,
    EvaluationResultModel,
)


class TestBasicEvaluateData:
    """Tests for BasicEvaluateData model."""

    def test_creates_with_all_fields(self):
        data = BasicEvaluateData(
            input="test input",
            output="test output",
            expected_output="expected output",
            contexts=["context 1", "context 2"],
            expected_contexts=["expected context"],
        )
        assert data.input == "test input"
        assert data.output == "test output"
        assert data.expected_output == "expected output"
        assert data.contexts == ["context 1", "context 2"]
        assert data.expected_contexts == ["expected context"]

    def test_creates_with_partial_fields(self):
        data = BasicEvaluateData(
            input="test input",
            output="test output",
        )
        assert data.input == "test input"
        assert data.output == "test output"
        assert data.expected_output is None

    def test_model_dump_excludes_none(self):
        data = BasicEvaluateData(
            input="test input",
            output="test output",
        )
        dumped = data.model_dump(exclude_none=True)
        assert "input" in dumped
        assert "output" in dumped
        assert "expected_output" not in dumped


class TestEvaluationResultModel:
    """Tests for EvaluationResultModel."""

    def test_creates_with_processed_status(self):
        result = EvaluationResultModel(
            status="processed",
            passed=True,
            score=0.95,
            details="Test passed",
            label="pass",
        )
        assert result.status == "processed"
        assert result.passed is True
        assert result.score == 0.95
        assert result.details == "Test passed"

    def test_creates_with_error_status(self):
        result = EvaluationResultModel(
            status="error",
            details="Something went wrong",
        )
        assert result.status == "error"
        assert result.details == "Something went wrong"
        assert result.passed is None

    def test_creates_with_skipped_status(self):
        result = EvaluationResultModel(
            status="skipped",
            details="Missing required data",
        )
        assert result.status == "skipped"


class TestEvaluate:
    """Tests for evaluate() function."""

    @patch("langwatch.evaluation.httpx.Client")
    @patch("langwatch.evaluation.langwatch.span")
    @patch("langwatch.evaluation.get_current_span")
    @patch("langwatch.evaluation.get_endpoint")
    @patch("langwatch.evaluation.get_api_key")
    @patch("langwatch.evaluation.get_instance")
    def test_calls_api_with_correct_parameters(
        self,
        mock_get_instance,
        mock_get_api_key,
        mock_get_endpoint,
        mock_get_current_span,
        mock_span_context,
        mock_client_class,
    ):
        # Setup mocks
        mock_get_endpoint.return_value = "https://api.langwatch.ai"
        mock_get_api_key.return_value = "test-api-key"
        mock_get_instance.return_value = MagicMock(disable_sending=False)

        mock_span_ctx = MagicMock()
        mock_span_ctx.is_valid = True
        mock_span_ctx.trace_id = 12345
        mock_span_ctx.span_id = 67890
        mock_get_current_span.return_value.get_span_context.return_value = mock_span_ctx

        # Mock span context manager
        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_span_context.return_value = mock_span

        # Mock HTTP client
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "status": "processed",
            "passed": True,
            "score": 0.95,
        }
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_class.return_value = mock_client

        # Call evaluate
        result = evaluate(
            "test-evaluator",
            data={"input": "test", "output": "response"},
            name="Test Evaluation",
            settings={"threshold": 0.5},
            as_guardrail=False,
        )

        # Verify result
        assert result.status == "processed"
        assert result.passed is True
        assert result.score == 0.95

        # Verify API was called with correct URL
        call_args = mock_client.post.call_args
        assert "https://api.langwatch.ai/api/evaluations/test-evaluator/evaluate" in str(
            call_args
        )

    @patch("langwatch.evaluation.httpx.Client")
    @patch("langwatch.evaluation.langwatch.span")
    @patch("langwatch.evaluation.get_current_span")
    @patch("langwatch.evaluation.get_endpoint")
    @patch("langwatch.evaluation.get_api_key")
    @patch("langwatch.evaluation.get_instance")
    def test_handles_guardrail_mode(
        self,
        mock_get_instance,
        mock_get_api_key,
        mock_get_endpoint,
        mock_get_current_span,
        mock_span_context,
        mock_client_class,
    ):
        # Setup mocks
        mock_get_endpoint.return_value = "https://api.langwatch.ai"
        mock_get_api_key.return_value = "test-api-key"
        mock_get_instance.return_value = MagicMock(disable_sending=False)

        mock_span_ctx = MagicMock()
        mock_span_ctx.is_valid = True
        mock_span_ctx.trace_id = 12345
        mock_span_ctx.span_id = 67890
        mock_get_current_span.return_value.get_span_context.return_value = mock_span_ctx

        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_span_context.return_value = mock_span

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "status": "processed",
            "passed": False,
            "details": "PII detected",
        }
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_class.return_value = mock_client

        result = evaluate(
            "presidio/pii_detection",
            data={"input": "My SSN is 123-45-6789"},
            as_guardrail=True,
        )

        assert result.status == "processed"
        assert result.passed is False
        assert result.details == "PII detected"

        # Verify span was created with guardrail type
        mock_span_context.assert_called_with(
            name="presidio/pii_detection", type="guardrail"
        )

    @patch("langwatch.evaluation.httpx.Client")
    @patch("langwatch.evaluation.langwatch.span")
    @patch("langwatch.evaluation.get_current_span")
    @patch("langwatch.evaluation.get_endpoint")
    @patch("langwatch.evaluation.get_api_key")
    @patch("langwatch.evaluation.get_instance")
    def test_handles_exception_in_guardrail_mode(
        self,
        mock_get_instance,
        mock_get_api_key,
        mock_get_endpoint,
        mock_get_current_span,
        mock_span_context,
        mock_client_class,
    ):
        # Setup mocks
        mock_get_endpoint.return_value = "https://api.langwatch.ai"
        mock_get_api_key.return_value = "test-api-key"
        mock_get_instance.return_value = MagicMock(disable_sending=False)

        mock_span_ctx = MagicMock()
        mock_span_ctx.is_valid = True
        mock_span_ctx.trace_id = 12345
        mock_span_ctx.span_id = 67890
        mock_get_current_span.return_value.get_span_context.return_value = mock_span_ctx

        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_span_context.return_value = mock_span

        # Make the client raise an exception
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = Exception("Network error")
        mock_client_class.return_value = mock_client

        result = evaluate(
            "test-evaluator",
            data={"input": "test"},
            as_guardrail=True,
        )

        # For guardrails, errors should default to passed=True
        assert result.status == "error"
        assert result.passed is True
        assert "Network error" in result.details

    @patch("langwatch.evaluation.httpx.Client")
    @patch("langwatch.evaluation.langwatch.span")
    @patch("langwatch.evaluation.get_current_span")
    @patch("langwatch.evaluation.get_endpoint")
    @patch("langwatch.evaluation.get_api_key")
    @patch("langwatch.evaluation.get_instance")
    def test_accepts_basic_evaluate_data(
        self,
        mock_get_instance,
        mock_get_api_key,
        mock_get_endpoint,
        mock_get_current_span,
        mock_span_context,
        mock_client_class,
    ):
        # Setup mocks
        mock_get_endpoint.return_value = "https://api.langwatch.ai"
        mock_get_api_key.return_value = "test-api-key"
        mock_get_instance.return_value = MagicMock(disable_sending=False)

        mock_span_ctx = MagicMock()
        mock_span_ctx.is_valid = True
        mock_span_ctx.trace_id = 12345
        mock_span_ctx.span_id = 67890
        mock_get_current_span.return_value.get_span_context.return_value = mock_span_ctx

        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_span_context.return_value = mock_span

        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "processed"}
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_class.return_value = mock_client

        # Use BasicEvaluateData
        data = BasicEvaluateData(
            input="test input",
            output="test output",
            expected_output="expected",
        )

        result = evaluate("test-evaluator", data=data)

        assert result.status == "processed"


class TestAsyncEvaluate:
    """Tests for async_evaluate() function."""

    @pytest.mark.asyncio
    @patch("langwatch.evaluation.httpx.AsyncClient")
    @patch("langwatch.evaluation.langwatch.span")
    @patch("langwatch.evaluation.get_current_span")
    @patch("langwatch.evaluation.get_endpoint")
    @patch("langwatch.evaluation.get_api_key")
    @patch("langwatch.evaluation.get_instance")
    async def test_calls_api_asynchronously(
        self,
        mock_get_instance,
        mock_get_api_key,
        mock_get_endpoint,
        mock_get_current_span,
        mock_span_context,
        mock_client_class,
    ):
        # Setup mocks
        mock_get_endpoint.return_value = "https://api.langwatch.ai"
        mock_get_api_key.return_value = "test-api-key"
        mock_get_instance.return_value = MagicMock(disable_sending=False)

        mock_span_ctx = MagicMock()
        mock_span_ctx.is_valid = True
        mock_span_ctx.trace_id = 12345
        mock_span_ctx.span_id = 67890
        mock_get_current_span.return_value.get_span_context.return_value = mock_span_ctx

        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        mock_span_context.return_value = mock_span

        # Mock async HTTP client
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "status": "processed",
            "passed": True,
            "score": 0.85,
        }
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client_class.return_value = mock_client

        result = await async_evaluate(
            "test-evaluator",
            data={"input": "test", "output": "response"},
            name="Test Async Evaluation",
        )

        assert result.status == "processed"
        assert result.passed is True
        assert result.score == 0.85


class TestDeprecatedEvaluations:
    """Tests for deprecated langwatch.evaluations module."""

    def test_imports_from_deprecated_module(self):
        """Test that the deprecated module still works."""
        import warnings

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            from langwatch.evaluations import (
                evaluate as deprecated_evaluate,
                BasicEvaluateData as DeprecatedBasicData,
            )

            # The deprecated decorator will emit warnings on use
            assert DeprecatedBasicData is BasicEvaluateData
