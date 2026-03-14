# Tests for explicit langwatch.origin attribute on root spans.
# Verifies that regular traces get origin="application" by default,
# and that experiments can override to origin="evaluation".

from typing import Sequence

from opentelemetry.sdk.trace import TracerProvider, ReadableSpan
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

from langwatch.telemetry.tracing import LangWatchTrace


class _InMemoryExporter(SpanExporter):
    """Minimal in-memory exporter for test assertions."""

    def __init__(self):
        self.spans: list[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        pass


def _make_provider_and_exporter():
    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider, exporter


def test_regular_trace_sets_origin_application():
    """Regular traces get langwatch.origin = 'application' on the root span."""
    provider, exporter = _make_provider_and_exporter()

    trace = LangWatchTrace(tracer_provider=provider)
    with trace:
        pass

    spans = exporter.spans
    assert len(spans) >= 1

    root_span = spans[0]
    assert root_span.attributes["langwatch.origin"] == "application"


def test_experiment_trace_overrides_origin_to_evaluation():
    """When experiments override origin after trace creation, it becomes 'evaluation'."""
    provider, exporter = _make_provider_and_exporter()

    trace = LangWatchTrace(tracer_provider=provider)
    with trace:
        if trace.root_span:
            trace.root_span.set_attributes({"langwatch.origin": "evaluation"})

    spans = exporter.spans
    assert len(spans) >= 1

    root_span = spans[0]
    assert root_span.attributes["langwatch.origin"] == "evaluation"


def test_origin_not_application_when_overridden():
    """If origin is overridden after creation, the override persists."""
    provider, exporter = _make_provider_and_exporter()

    trace = LangWatchTrace(tracer_provider=provider)
    with trace:
        if trace.root_span:
            trace.root_span.set_attributes({"langwatch.origin": "simulation"})

    spans = exporter.spans
    assert len(spans) >= 1

    root_span = spans[0]
    assert root_span.attributes["langwatch.origin"] == "simulation"
