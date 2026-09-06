# Remote traceparent adoption across the tracing styles the SDK proposes.
#
# LangWatch simulations send a W3C traceparent header on every scenario call,
# and the judge fetches the agent's spans by that trace id. These tests pin
# which extraction pattern makes each style join the caller's trace:
# attach() before any tracing starts covers everything, including handlers
# decorated with @langwatch.trace(), whose root span opens before the handler
# body runs. That ordering is why the docs put the extraction in middleware.
#
# See specs/telemetry/traceparent-adoption.feature

from typing import Sequence

from opentelemetry import propagate
from opentelemetry.context import Context, attach, detach
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

import langwatch
from langwatch.telemetry.tracing import LangWatchTrace

REMOTE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
REMOTE_SPAN_ID = "00f067aa0ba902b7"
HEADERS = {"traceparent": f"00-{REMOTE_TRACE_ID}-{REMOTE_SPAN_ID}-01"}


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


def _trace_ids(exporter: _InMemoryExporter) -> set:
    return {f"{s.context.trace_id:032x}" for s in exporter.spans}


def test_attach_before_decorated_handler_joins_the_remote_trace():
    """attach() before the handler runs puts a @langwatch.trace() root span
    inside the remote trace, parented under the caller's span."""
    provider, exporter = _make_provider_and_exporter()

    @langwatch.trace(name="handler", tracer_provider=provider)
    def handler():
        pass

    token = attach(propagate.extract(HEADERS))
    try:
        handler()
    finally:
        detach(token)

    assert _trace_ids(exporter) == {REMOTE_TRACE_ID}
    root = exporter.spans[0]
    assert root.parent is not None
    assert f"{root.parent.span_id:016x}" == REMOTE_SPAN_ID


def test_decorated_handler_without_early_extraction_starts_its_own_trace():
    """Without an attached remote context, the decorator opens a fresh trace.
    The handler body cannot fix this: the root span already exists by the
    time the body runs, which is why extraction belongs in middleware."""
    provider, exporter = _make_provider_and_exporter()

    @langwatch.trace(name="handler", tracer_provider=provider)
    def handler():
        pass

    # Run under an empty context. The scenario is "nothing attached", and
    # whatever span happens to be current when this test starts would
    # otherwise parent the handler and decide the assertion below.
    token = attach(Context())
    try:
        handler()
    finally:
        detach(token)

    assert REMOTE_TRACE_ID not in _trace_ids(exporter)
    assert exporter.spans[0].parent is None


def test_attach_covers_plain_opentelemetry_spans():
    """A handler that only uses plain OpenTelemetry spans joins the remote
    trace the same way."""
    provider, exporter = _make_provider_and_exporter()
    tracer = provider.get_tracer("agent")

    token = attach(propagate.extract(HEADERS))
    try:
        with tracer.start_as_current_span("llm-call"):
            pass
    finally:
        detach(token)

    assert _trace_ids(exporter) == {REMOTE_TRACE_ID}


def test_attach_covers_a_context_manager_trace_and_nested_spans():
    """with langwatch.trace() plus nested langwatch spans all land in the
    remote trace, with the root span parented under the caller's span."""
    provider, exporter = _make_provider_and_exporter()

    token = attach(propagate.extract(HEADERS))
    try:
        with LangWatchTrace(name="handler", tracer_provider=provider) as t:
            with t.span(name="tool-call"):
                pass
    finally:
        detach(token)

    assert _trace_ids(exporter) == {REMOTE_TRACE_ID}
    by_name = {s.name: s for s in exporter.spans}
    root = by_name["handler"]
    assert root.parent is not None
    assert f"{root.parent.span_id:016x}" == REMOTE_SPAN_ID
    assert by_name["tool-call"].parent is not None
    assert by_name["tool-call"].parent.span_id == root.context.span_id


def test_a_with_block_covers_a_trace_started_inside_it():
    """The narrower pattern stays valid: a span opened with the extracted
    context parents everything started inside its block, and only that. Work
    the handler does before the block stays outside the remote trace, which
    is the limit that makes middleware the better placement."""
    provider, exporter = _make_provider_and_exporter()
    tracer = provider.get_tracer("agent")

    with tracer.start_as_current_span("before-block"):
        pass

    ctx = propagate.extract(HEADERS)
    with tracer.start_as_current_span("chat", context=ctx):
        with LangWatchTrace(name="inner", tracer_provider=provider):
            pass

    by_name = {s.name: s for s in exporter.spans}
    assert f"{by_name['chat'].context.trace_id:032x}" == REMOTE_TRACE_ID
    assert f"{by_name['inner'].context.trace_id:032x}" == REMOTE_TRACE_ID
    assert f"{by_name['before-block'].context.trace_id:032x}" != REMOTE_TRACE_ID
