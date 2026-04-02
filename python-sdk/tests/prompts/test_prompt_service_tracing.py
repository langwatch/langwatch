"""
Tests for PromptService.get tracing functionality.
"""

from unittest.mock import Mock, patch
import pytest
from langwatch.prompts.prompt_api_service import PromptApiService
from langwatch.attributes import AttributeKey

from fixtures.span_exporter import MockSpanExporter, span_exporter


def test_get_method_emits_combined_format_when_handle_and_version_present(
    span_exporter: MockSpanExporter, mock_api_response_for_tracing
):
    """Test that PromptService.get emits combined 'handle:version' format"""
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

        service.get("prompt_123")

        span = span_exporter.find_span_by_name("PromptApiService.get")
        assert span is not None

        assert span.attributes is not None
        # Combined format: "handle:version"
        assert span.attributes.get(AttributeKey.LangWatchPromptId) == "prompt_123:1"
        # Old separate attributes should NOT be present
        assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
        assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None


def test_get_method_emits_nothing_when_handle_missing(
    span_exporter: MockSpanExporter, mock_api_response_for_tracing
):
    """Test that PromptService.get emits no prompt id when handle is None"""
    mock_client = Mock()
    service = PromptApiService(mock_client)

    # Override handle to None to trigger emit-nothing behavior
    mock_api_response_for_tracing.handle = None

    with (
        patch("langwatch.prompts.prompt_api_service.get_api_prompts_by_id") as mock_api,
        patch(
            "langwatch.prompts.prompt_api_service.unwrap_response",
            return_value=mock_api_response_for_tracing,
        ),
    ):

        mock_api.sync_detailed.return_value = Mock()

        service.get("prompt_123")

        span = span_exporter.find_span_by_name("PromptApiService.get")
        assert span is not None

        assert span.attributes is not None
        # No prompt id attribute should be set
        assert span.attributes.get(AttributeKey.LangWatchPromptId) is None
        assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
        assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None


def test_get_method_emits_nothing_when_version_missing(
    span_exporter: MockSpanExporter, mock_api_response_for_tracing
):
    """Test that PromptService.get emits no prompt id when version is None"""
    mock_client = Mock()
    service = PromptApiService(mock_client)

    # Override version to None to trigger emit-nothing behavior
    mock_api_response_for_tracing.version = None

    with (
        patch("langwatch.prompts.prompt_api_service.get_api_prompts_by_id") as mock_api,
        patch(
            "langwatch.prompts.prompt_api_service.unwrap_response",
            return_value=mock_api_response_for_tracing,
        ),
    ):

        mock_api.sync_detailed.return_value = Mock()

        service.get("prompt_123")

        span = span_exporter.find_span_by_name("PromptApiService.get")
        assert span is not None

        assert span.attributes is not None
        # No prompt id attribute should be set
        assert span.attributes.get(AttributeKey.LangWatchPromptId) is None
        assert span.attributes.get(AttributeKey.LangWatchPromptHandle) is None
        assert span.attributes.get(AttributeKey.LangWatchPromptVersionId) is None
