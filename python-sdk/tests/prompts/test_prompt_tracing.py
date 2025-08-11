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


class TestSpanExporter(SpanExporter):
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
def span_exporter():
    """Set up tracing with test exporter"""
    exporter = TestSpanExporter()
    tracer_provider = trace_sdk.TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(tracer_provider)
    return exporter


def test_prompt_compile_creates_trace_span(span_exporter: TestSpanExporter):
    """Test that Prompt.compile creates a trace span"""
    # Setup mock prompt
    mock_config = Mock()
    mock_config.id = "prompt_123"
    mock_config.version_id = "prompt_version_7"
    mock_config.version = 1

    # Import here to avoid circular import issues when compile method is added
    from langwatch.prompts.prompt import Prompt

    prompt = Prompt(mock_config)

    # Mock the compile method (since it doesn't exist yet)
    with patch.object(prompt, "compile") as mock_compile:
        mock_compile.return_value = Mock(
            prompt="Hello Alice, how is the weather today?",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Tell me about weather"},
            ],
        )

        # Execute
        prompt.compile(name="Alice", topic="weather")

        # Verify span was created
        span = span_exporter.find_span_by_name("compile")
        assert span is not None

        # Type assertion for linter
        assert span.attributes is not None
        assert span.attributes.get("langwatch.prompt.type") == "prompt"
        assert span.attributes.get("langwatch.prompt.id") == "prompt_123"
        assert span.attributes.get("langwatch.prompt.version.id") == "prompt_version_7"
        assert span.attributes.get("langwatch.prompt.version.number") == 1
