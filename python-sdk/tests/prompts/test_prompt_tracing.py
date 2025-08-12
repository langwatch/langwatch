"""
Simple test for PromptService.get tracing functionality.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from typing import Optional, Sequence

from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import (
    SpanExportResult,
    SpanExporter,
    SimpleSpanProcessor,
)
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry import trace
from langwatch.prompts.prompt import Prompt
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from fixtures import GetPromptResponseFactory
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_messages_item_role import (
    PostApiPromptsResponse200MessagesItemRole,
)


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


@pytest.fixture(scope="session")
def tracer_provider():
    """Set up tracing with test tracer provider (session-scoped)"""
    tracer_provider = trace_sdk.TracerProvider()
    trace.set_tracer_provider(tracer_provider)
    return tracer_provider


@pytest.fixture
def span_exporter(tracer_provider: trace_sdk.TracerProvider):
    """Set up span exporter for each test"""
    exporter = MockSpanExporter()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))

    yield exporter

    tracer_provider.force_flush()


@pytest.fixture
def mock_config() -> GetApiPromptsByIdResponse200:
    """Type-safe configuration object from actual API response types"""
    return GetPromptResponseFactory(
        id="prompt_123",
        version=1.0,  # Use float instead of string for proper typing
        prompt="Hello {{ name }}!",
        messages=[
            {
                "role": PostApiPromptsResponse200MessagesItemRole.USER,
                "content": "Say {{ greeting }} to {{ name }}",
            },
        ],
    )


@pytest.fixture
def prompt(mock_config: GetApiPromptsByIdResponse200) -> Prompt:
    """Create a Prompt instance with factory-generated config"""
    return Prompt(mock_config)


def test_prompt_compile_creates_trace_span(
    span_exporter: MockSpanExporter, prompt: Prompt
):
    """Test that Prompt.compile creates a trace span"""
    prompt.compile(name="Alice")

    # Verify span was created
    span = span_exporter.find_span_by_name("compile")
    assert span is not None

    # Type assertion for linter
    assert span.attributes is not None
    assert span.attributes.get("langwatch.prompt.type") == "prompt"
    assert span.attributes.get("langwatch.prompt.id") == "prompt_123"
    assert span.attributes.get("langwatch.prompt.version.id") == "version_0"
    assert span.attributes.get("langwatch.prompt.version.number") == 1


def test_prompt_compile_strict_creates_trace_span(
    span_exporter: MockSpanExporter, prompt: Prompt
):
    """Test that Prompt.compile_strict creates a trace span"""
    prompt.compile_strict(name="Alice", greeting="Hello")

    # Verify span was created
    span = span_exporter.find_span_by_name("compile_strict")
    assert span is not None

    # Type assertion for linter
    assert span.attributes is not None
    assert span.attributes.get("langwatch.prompt.type") == "prompt"
    assert span.attributes.get("langwatch.prompt.id") == "prompt_123"
    assert span.attributes.get("langwatch.prompt.version.id") == "version_1"
    assert span.attributes.get("langwatch.prompt.version.number") == 1
