"""
Simple test for PromptService.get tracing functionality.
"""

from unittest.mock import Mock, patch
import pytest
from langwatch.prompts.prompt_api_service import PromptApiService
from langwatch.attributes import AttributeKey

from fixtures.span_exporter import MockSpanExporter, span_exporter


def test_get_method_creates_trace_span(
    span_exporter: MockSpanExporter, mock_api_response_for_tracing
):
    """Test that PromptService.get creates a trace span"""
    # Setup mocks
    mock_client = Mock()
    service = PromptApiService(mock_client)

    with (
        patch("langwatch.prompts.prompt_api_service.get_api_prompts_by_id") as mock_api,
        patch(
            "langwatch.prompts.prompt_api_service.unwrap_response",
            return_value=mock_api_response_for_tracing,
        ),
    ):

        mock_api.sync_detailed.return_value = Mock()

        # Execute
        service.get("prompt_123")

        # Verify span was created
        span = span_exporter.find_span_by_name("PromptApiService.get")
        assert span is not None

        # Type assertion for linter
        assert span.attributes is not None
        assert span.attributes.get(AttributeKey.LangWatchPromptId) == "prompt_123"
        assert span.attributes.get(AttributeKey.LangWatchPromptHandle) == "prompt_123"
        assert (
            span.attributes.get(AttributeKey.LangWatchPromptVersionId)
            == "prompt_version_3"
        )
