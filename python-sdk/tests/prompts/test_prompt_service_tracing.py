"""
Simple test for PromptService.get tracing functionality.
"""

import pytest
from typing import Optional, Sequence
from unittest.mock import Mock, patch

from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import (
    SpanExportResult,
    SpanExporter,
    SimpleSpanProcessor,
)
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry import trace

from langwatch.prompts.service import PromptService
from langwatch.attributes import AttributeKey

tracer_provider = trace_sdk.TracerProvider()


class MockSpanExporter(SpanExporter):
    """Simple span exporter that captures spans for testing"""

    def __init__(self):
        self.spans: list[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def find_span_by_name(self, name: str) -> Optional[ReadableSpan]:
        for span in self.spans:
            if span.name == name:
                return span
        return None


@pytest.fixture
def span_exporter() -> MockSpanExporter:
    """Set up span exporter for each test"""
    exporter = MockSpanExporter()

    provider = trace.get_tracer_provider()
    if not hasattr(provider, "add_span_processor"):
        trace.set_tracer_provider(trace_sdk.TracerProvider())
        provider = trace.get_tracer_provider()

    provider.add_span_processor(SimpleSpanProcessor(exporter))
    yield exporter


def test_get_method_creates_trace_span(span_exporter: MockSpanExporter):
    """Test that PromptService.get creates a trace span"""
    # Setup mocks
    mock_client = Mock()
    service = PromptService(mock_client)

    mock_config = Mock(
        id="prompt_123",
        version_id="prompt_version_3",
        handle="prompt_123",
    )

    with (
        patch("langwatch.prompts.service.get_api_prompts_by_id") as mock_api,
        patch("langwatch.prompts.service.unwrap_response", return_value=mock_config),
    ):

        mock_api.sync_detailed.return_value = Mock()

        # Execute
        service.get("prompt_123")

        # Verify span was created
        span = span_exporter.find_span_by_name("PromptService.get")
        assert span is not None

        # Type assertion for linter
        assert span.attributes is not None
        assert span.attributes.get(AttributeKey.LangWatchPromptId) == "prompt_123"
        assert span.attributes.get(AttributeKey.LangWatchPromptHandle) == "prompt_123"
        assert (
            span.attributes.get(AttributeKey.LangWatchPromptVersionId)
            == "prompt_version_3"
        )
