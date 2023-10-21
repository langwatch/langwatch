from contextlib import contextmanager
import functools
import json
import threading
from typing import Any, Dict, List, Literal, Optional, TypeVar, TypedDict
import nanoid
import requests
from concurrent.futures import ThreadPoolExecutor
from retry import retry

import langwatch
from langwatch.types import BaseSpan, ErrorCapture, Span, SpanTimestamps, SpanTypes
from langwatch.utils import (
    autoconvert_typed_values,
    capture_exception,
    milliseconds_timestamp,
)

T = TypeVar("T")

_local_context = threading.local()


class ContextSpan:
    id: str
    parent: Optional["ContextSpan"] = None
    name: Optional[str]
    type: SpanTypes
    input: Any
    output: Optional[Any] = None
    started_at: int

    def __init__(
        self, id: str, name: Optional[str], type: SpanTypes = "span", input: Any = None
    ) -> None:
        self.id = id
        self.name = name
        self.type = type
        self.input = input

        current_span = getattr(_local_context, "current_span", None)

        if current_span:
            self.parent = current_span

        _local_context.current_span = self

        self.started_at = milliseconds_timestamp()

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, exc_value: Optional[BaseException], _exc_traceback):
        error: Optional[ErrorCapture] = (
            capture_exception(exc_value) if exc_value else None
        )
        finished_at = milliseconds_timestamp()

        context_tracer: Optional[BaseContextTracer] = getattr(
            _local_context, "current_tracer", None
        )
        if context_tracer:
            id = self.id  # TODO: test?
            context_tracer.append_span(
                BaseSpan(
                    type=self.type,
                    name=self.name,
                    id=id,
                    parent_id=self.parent.id if self.parent else None,  # TODO: test
                    trace_id=context_tracer.trace_id,  # TODO: test
                    input=autoconvert_typed_values(self.input) if self.input else None,
                    outputs=[autoconvert_typed_values(self.output)]
                    if self.output
                    else [],  # TODO
                    error=error,  # TODO: test
                    timestamps=SpanTimestamps(
                        started_at=self.started_at, finished_at=finished_at
                    ),
                )
            )

        _local_context.current_span = self.parent


def create_span(
    name: Optional[str] = None, type: SpanTypes = "span", input: Any = None
):
    return ContextSpan(
        id=f"span_{nanoid.generate()}", name=name, type=type, input=input
    )


def span(name: Optional[str] = None, type: SpanTypes = "span"):
    def _span(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            all_args = (
                {str(index): item for index, item in enumerate(args)} if args else {}
            )
            if kwargs:
                all_args.update(kwargs)

            with create_span(name=(name or func.__name__), type=type, input=all_args) as span:
                output = func(*args, **kwargs)
                span.output = output
                return output

        return wrapper

    return _span


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
        span["id"] = span.get("id", f"span_{nanoid.generate()}")
        self.spans[span["id"]] = span

    def get_parent_id(self):
        current_span: Optional[ContextSpan] = getattr(
            _local_context, "current_span", None
        )
        if current_span:
            return current_span.id
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
