from typing import Optional, Sequence
import pytest

from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import (
    SpanExportResult,
    SpanExporter,
    SimpleSpanProcessor,
)
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry import trace


tracer_provider = trace_sdk.TracerProvider()

# OpenTelemetry tracing test infrastructure
# This module provides testing utilities for verifying that LangWatch PromptService operations
# create proper OpenTelemetry spans with the correct attributes.


class MockSpanExporter(SpanExporter):
    """
    Test-only span exporter that captures spans in memory for verification.

    This exporter implements the OpenTelemetry SpanExporter interface but instead
    of sending spans to an external system, it stores them in a list for test assertions.
    This allows tests to verify that spans are created with the correct names and attributes.
    """

    def __init__(self):
        # Store all exported spans for later inspection in tests
        self.spans: list[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]):
        """
        Capture spans in memory instead of exporting to external system.

        Args:
            spans: Sequence of spans to export

        Returns:
            SpanExportResult.SUCCESS to indicate successful "export"
        """
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def find_span_by_name(self, name: str) -> Optional[ReadableSpan]:
        """
        Helper method to find a span by its operation name.

        Args:
            name: The span name to search for (e.g., "PromptService.get")

        Returns:
            The first span with matching name, or None if not found
        """
        for span in self.spans:
            if span.name == name:
                return span
        return None


@pytest.fixture
def span_exporter():
    """
    Pytest fixture that sets up OpenTelemetry tracing infrastructure for tests.

    This fixture:
    1. Creates a MockSpanExporter to capture spans
    2. Ensures a TracerProvider is available (creates one if needed)
    3. Configures the provider to use our mock exporter via SimpleSpanProcessor
    4. Yields the exporter for test use
    5. Cleans up by shutting down the provider after the test

    The SimpleSpanProcessor processes spans synchronously, making them immediately
    available in the exporter for test assertions.

    Yields:
        MockSpanExporter: Configured exporter with captured spans
    """
    exporter = MockSpanExporter()

    # Get current tracer provider, ensuring we have a proper SDK provider
    provider = trace.get_tracer_provider()
    if not hasattr(provider, "add_span_processor"):
        # If no SDK provider is set, create and configure one
        trace.set_tracer_provider(trace_sdk.TracerProvider())
        provider = trace.get_tracer_provider()

    # Configure the provider to send spans to our mock exporter
    # SimpleSpanProcessor processes spans synchronously for immediate availability
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    yield exporter

    # Clean up tracing infrastructure after test completes
    provider.shutdown()
