from contextlib import contextmanager
import json
import threading
from typing import Dict, List, Optional, TypeVar, TypedDict
import nanoid
import requests
from concurrent.futures import ThreadPoolExecutor
from retry import retry

import langwatch
from langwatch.types import BaseSpan, ErrorCapture, Span, SpanTimestamps
from langwatch.utils import capture_exception, milliseconds_timestamp

T = TypeVar("T")

_local_context = threading.local()


class ContextSpan(TypedDict):
    id: str
    parent: Optional["ContextSpan"]
    name: str


@contextmanager
def span(name: Optional[str] = None):
    context_span = ContextSpan(id=f"span_{nanoid.generate()}", parent=None, name=name)

    current_span = getattr(_local_context, "current_span", None)

    if current_span:
        context_span["parent"] = current_span

    _local_context.current_span = context_span

    started_at = milliseconds_timestamp()
    error: Optional[ErrorCapture] = None
    try:
        yield
    except Exception as err:
        error = capture_exception(err)
    finished_at = milliseconds_timestamp()

    context_tracer: Optional[BaseContextTracer] = getattr(
        _local_context, "current_tracer", None
    )
    if context_tracer:
        span_id = context_span["id"]  # TODO: test?
        context_tracer.append_span(
            BaseSpan(
                type="span",
                name=name,
                span_id=span_id,
                parent_id=context_span["parent"]["id"]
                if context_span["parent"]
                else None,  # TODO: test
                trace_id=context_tracer.trace_id,  # TODO: test
                outputs=[],  # TODO
                error=error,  # TODO: test
                timestamps=SpanTimestamps(
                    started_at=started_at, finished_at=finished_at
                ),
            )
        )

    _local_context.current_span = context_span["parent"]


class BaseContextTracer:
    def __init__(self, trace_id: Optional[str] = None):
        self.spans: Dict[str, Span] = {}
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"

    def __enter__(self):
        _local_context.current_tracer = self
        return self

    def __exit__(self, _type, _value, _traceback):
        send_spans(list(self.spans.values()))
        _local_context.current_tracer = None

    def append_span(self, span: Span):
        span["span_id"] = span.get("span_id", f"span_{nanoid.generate()}")
        self.spans[span["span_id"]] = span

    def get_parent_id(self):
        current_span = getattr(_local_context, "current_span", None)
        if current_span:
            return current_span["id"]
        return None


executor = ThreadPoolExecutor(max_workers=10)


@retry(tries=5, delay=0.5, backoff=3)
def _send_spans(spans: List[Span]):
    response = requests.post(langwatch.endpoint, json={"spans": spans})
    response.raise_for_status()


def send_spans(spans: List[Span]):
    if len(spans) == 0:
        return
    executor.submit(_send_spans, spans)
