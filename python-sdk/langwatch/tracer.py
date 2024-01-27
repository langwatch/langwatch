import functools
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
import time
from typing import Any, Dict, List, Optional, TypeVar

import nanoid
import requests
from langwatch.types import (
    BaseSpan,
    ErrorCapture,
    RAGChunk,
    RAGSpan,
    Span,
    SpanTimestamps,
    SpanTypes,
    CollectorRESTParams,
)
from langwatch.utils import (
    autoconvert_typed_values,
    capture_exception,
    milliseconds_timestamp,
)
from retry import retry

import langwatch

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
                self.create_span(id, context_tracer, error, finished_at)
            )

        _local_context.current_span = self.parent

    def create_span(
        self,
        id: str,
        context_tracer: Any,
        error: Optional[ErrorCapture],
        finished_at: int,
    ) -> BaseSpan:
        return BaseSpan(
            type=self.type,
            name=self.name,
            id=id,
            parent_id=self.parent.id if self.parent else None,  # TODO: test
            trace_id=context_tracer.trace_id,  # TODO: test
            input=autoconvert_typed_values(self.input) if self.input else None,
            outputs=[autoconvert_typed_values(self.output)]
            if self.output
            else [],  # TODO test?
            error=error,  # TODO: test
            timestamps=SpanTimestamps(
                started_at=self.started_at, finished_at=finished_at
            ),
        )


class ContextRAGSpan(ContextSpan):
    contexts: List[RAGChunk]

    def __init__(
        self,
        id: str,
        name: Optional[str],
        input: Any = None,
        contexts: List[RAGChunk] = [],
    ) -> None:
        super().__init__(id, name, type="rag", input=input)
        self.contexts = contexts

    def create_span(
        self,
        id: str,
        context_tracer: Any,
        error: Optional[ErrorCapture],
        finished_at: int,
    ) -> RAGSpan:
        span: Any = super().create_span(id, context_tracer, error, finished_at)
        rag_span: RAGSpan = {**span, "type": "rag", "contexts": self.contexts}

        return rag_span


def create_span(
    name: Optional[str] = None, type: SpanTypes = "span", input: Any = None
):
    return ContextSpan(
        id=f"span_{nanoid.generate()}", name=name, type=type, input=input
    )


def capture_rag(
    contexts: List[RAGChunk],
    input: Optional[str] = None,
    name: str = "RetrievalAugmentedGeneration",
):
    return ContextRAGSpan(
        id=f"span_{nanoid.generate()}", name=name, input=input, contexts=contexts
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

            with create_span(
                name=(name or func.__name__), type=type, input=all_args
            ) as span:
                output = func(*args, **kwargs)
                span.output = output
                return output

        return wrapper

    return _span


executor = ThreadPoolExecutor(max_workers=10)


class BaseContextTracer:
    sent_once = False
    scheduled_send: Optional[Future[None]] = None

    def __init__(
        self,
        trace_id: Optional[str],
        user_id: Optional[str],
        thread_id: Optional[str],
        customer_id: Optional[str],
        labels: List[str],
    ):
        self.spans: Dict[str, Span] = {}
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"
        self.user_id = user_id
        self.thread_id = thread_id
        self.customer_id = customer_id
        self.labels = labels

    def __enter__(self):
        _local_context.current_tracer = self
        return self

    def __exit__(self, _type, _value, _traceback):
        self.delayed_send_spans()
        _local_context.current_tracer = None

    def delayed_send_spans(self):
        self._add_finished_at_to_missing_spans()

        def send_spans_sync():
            send_spans(
                CollectorRESTParams(
                    trace_id=self.trace_id,
                    spans=list(self.spans.values()),
                    user_id=self.user_id,
                    thread_id=self.thread_id,
                    customer_id=self.customer_id,
                    labels=self.labels,
                    experiments=[],
                )
            )

        if "PYTEST_CURRENT_TEST" in os.environ:
            # Keep on the same thread for tests
            send_spans_sync()
            return

        def run_in_thread():
            time.sleep(1)  # wait for other spans to be added
            self.sent_once = True
            send_spans_sync()

        if self.scheduled_send and not self.scheduled_send.done():
            self.scheduled_send.cancel()

        self.scheduled_send = executor.submit(run_in_thread)

    def append_span(self, span: Span):
        span["id"] = span.get("id", f"span_{nanoid.generate()}")
        self.spans[span["id"]] = span
        if self.sent_once:
            self.delayed_send_spans()  # send again if needed

    def get_parent_id(self):
        current_span: Optional[ContextSpan] = getattr(
            _local_context, "current_span", None
        )
        if current_span:
            return current_span.id
        return None

    # Some spans get interrupted in the middle, for example by an exception, and we might end up never tagging their finish timestamp, so we do it here as a fallback
    def _add_finished_at_to_missing_spans(self):
        for span in self.spans.values():
            if "timestamps" in span and (
                "finished_at" not in span["timestamps"]
                or span["timestamps"]["finished_at"] == None
            ):
                span["timestamps"]["finished_at"] = milliseconds_timestamp()


@retry(tries=5, delay=0.5, backoff=3)
def send_spans(data: CollectorRESTParams):
    if len(data["spans"]) == 0:
        return
    if not langwatch.api_key:
        return
    response = requests.post(
        langwatch.endpoint,
        json=data,
        headers={"X-Auth-Token": str(langwatch.api_key)},
    )
    response.raise_for_status()
