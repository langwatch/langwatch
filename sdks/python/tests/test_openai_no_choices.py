"""The OpenAI tracer tolerates a response whose choices is None.

The AI Gateway commits status 200 with heartbeat bytes on a slow
non-streaming call; a provider failure after that arrives as an error
envelope under the 200, and the openai client builds a ChatCompletion with
choices=None from it. See specs/python-sdk/openai-tracer-error-body.feature.
"""

import json
from typing import Any, Dict, List, Sequence

import httpx
from openai import OpenAI
from openai.types import Completion
from openai.types.chat import ChatCompletionChunk
from openai.types.chat.chat_completion_chunk import Choice, ChoiceDelta
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.trace import StatusCode
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

import langwatch
from langwatch.domain import SpanTimestamps
from langwatch.openai import OpenAIChatCompletionTracer, OpenAICompletionTracer

ERROR_ENVELOPE: Dict[str, Any] = {
    "error": {
        "type": "provider_timeout",
        "code": "provider_timeout",
        "message": "provider timeout",
        "meta": {
            "tips": ["The provider accepted the request and did not answer in time"]
        },
        "fault": "provider",
    }
}


class _InMemoryExporter(SpanExporter):
    def __init__(self):
        self.spans: List[ReadableSpan] = []

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        pass


def _heartbeat_committed_error(request: httpx.Request) -> httpx.Response:
    body = b"   " + json.dumps(ERROR_ENVELOPE).encode()
    return httpx.Response(
        200,
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-LangWatch-Heartbeat-Active": "true",
        },
    )


def _capture_end_span(tracer: Any, call) -> List[List[Any]]:
    captured: List[List[Any]] = []
    original = tracer.end_span

    def capture(cls, client, span, outputs, metrics, timestamps, **kwargs):
        captured.append(list(outputs))

    tracer.end_span = classmethod(capture)
    try:
        call()
    finally:
        tracer.end_span = original
    return captured


# @scenario "a chat completion with no choices returns the caller's response untouched"
def test_chat_completion_without_choices_returns_the_callers_response_untouched():
    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    client = OpenAI(
        api_key="test",
        base_url="http://gateway.test/v1",
        http_client=httpx.Client(
            transport=httpx.MockTransport(_heartbeat_committed_error)
        ),
        max_retries=0,
    )

    with langwatch.trace(name="caller", tracer_provider=provider) as trace:
        trace.autotrack_openai_calls(client)
        response = client.chat.completions.create(
            model="gpt-5-mini", messages=[{"role": "user", "content": "hi"}]
        )

    assert response.choices is None
    assert response.model_extra is not None
    assert response.model_extra["error"] == ERROR_ENVELOPE["error"]
    llm_spans = [
        s
        for s in exporter.spans
        if (s.attributes or {}).get("langwatch.span.type") == "llm"
    ]
    assert len(llm_spans) == 1
    assert "langwatch.output" not in (llm_spans[0].attributes or {})


# @scenario "a chat completion carrying the error envelope marks the span as an error"
def test_chat_completion_with_error_envelope_marks_the_span_as_an_error():
    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    client = OpenAI(
        api_key="test",
        base_url="http://gateway.test/v1",
        http_client=httpx.Client(
            transport=httpx.MockTransport(_heartbeat_committed_error)
        ),
        max_retries=0,
    )

    with langwatch.trace(name="caller", tracer_provider=provider) as trace:
        trace.autotrack_openai_calls(client)
        response = client.chat.completions.create(
            model="gpt-5-mini", messages=[{"role": "user", "content": "hi"}]
        )

    assert response.choices is None
    llm_span = next(
        s
        for s in exporter.spans
        if (s.attributes or {}).get("langwatch.span.type") == "llm"
    )
    assert llm_span.status.status_code == StatusCode.ERROR
    exception_events = [e for e in llm_span.events if e.name == "exception"]
    assert len(exception_events) == 1
    event_attributes = exception_events[0].attributes or {}
    assert event_attributes["exception.message"] == "provider timeout"
    assert (llm_span.attributes or {})["error.type"] == "provider_timeout"


# @scenario "a legacy completion with no choices records no output"
def test_legacy_completion_without_choices_records_no_output():
    response = Completion.construct(choices=None)

    captured = _capture_end_span(
        OpenAICompletionTracer,
        lambda: OpenAICompletionTracer.handle_completion(
            client=None,  # type: ignore[arg-type]
            span=None,  # type: ignore[arg-type]
            response=response,
            timestamps=SpanTimestamps(started_at=0, finished_at=1),
        ),
    )

    assert captured == [[]]


# @scenario "a response with no choices and no error body is not an error"
def test_completion_without_choices_or_error_body_is_not_an_error():
    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    client = OpenAI(
        api_key="test",
        base_url="http://gateway.test/v1",
        http_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"id": "x", "object": "chat.completion", "model": "m"}
                )
            )
        ),
        max_retries=0,
    )

    with langwatch.trace(name="caller", tracer_provider=provider) as trace:
        trace.autotrack_openai_calls(client)
        client.chat.completions.create(
            model="gpt-5-mini", messages=[{"role": "user", "content": "hi"}]
        )

    llm_span = next(
        s
        for s in exporter.spans
        if (s.attributes or {}).get("langwatch.span.type") == "llm"
    )
    assert llm_span.status.status_code != StatusCode.ERROR


# @scenario "a legacy completion carrying the error envelope marks the span as an error"
def test_legacy_completion_with_error_envelope_marks_the_span_as_an_error():
    response = Completion.construct(choices=None, **ERROR_ENVELOPE)
    errors: List[Any] = []
    original = OpenAICompletionTracer.end_span

    def capture(cls, client, span, outputs, metrics, timestamps, error=None, **kw):
        errors.append(error)

    class _Span:
        attributes: Dict[str, Any] = {}

        def set_attributes(self, attributes: Dict[str, Any]):
            self.attributes.update(attributes)

    span = _Span()
    OpenAICompletionTracer.end_span = classmethod(capture)  # type: ignore[method-assign]
    try:
        OpenAICompletionTracer.handle_completion(
            client=None,  # type: ignore[arg-type]
            span=span,  # type: ignore[arg-type]
            response=response,
            timestamps=SpanTimestamps(started_at=0, finished_at=1),
        )
    finally:
        OpenAICompletionTracer.end_span = original  # type: ignore[method-assign]

    assert [str(e) for e in errors] == ["provider timeout"]
    assert span.attributes == {"error.type": "provider_timeout"}


# @scenario "a streamed chunk with no choices is skipped"
def test_streamed_chunk_without_choices_is_skipped():
    content_chunk = ChatCompletionChunk(
        id="chatcmpl-test",
        object="chat.completion.chunk",
        created=1,
        model="gpt-5-mini",
        choices=[
            Choice(
                index=0,
                delta=ChoiceDelta(role="assistant", content="Hello"),
                finish_reason=None,
            )
        ],
    )
    empty_chunk = ChatCompletionChunk.construct(choices=None)

    captured = _capture_end_span(
        OpenAIChatCompletionTracer,
        lambda: OpenAIChatCompletionTracer.handle_deltas(
            client=None,  # type: ignore[arg-type]
            span=None,  # type: ignore[arg-type]
            deltas=[content_chunk, empty_chunk],
            timestamps=SpanTimestamps(started_at=0, finished_at=1),
        ),
    )

    assert captured[0][0]["value"][0]["content"] == "Hello"
