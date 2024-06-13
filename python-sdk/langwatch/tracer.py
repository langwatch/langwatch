import asyncio
import os
from concurrent.futures import Future, ThreadPoolExecutor
import time
from typing import Any, Dict, List, Optional, TypeVar
from warnings import warn
from deprecated import deprecated

import nanoid
from pydantic import BaseModel
import requests
from langwatch.types import (
    BaseSpan,
    LLMSpan,
    LLMSpanMetrics,
    LLMSpanParams,
    RAGChunk,
    RAGSpan,
    Span,
    SpanInputOutput,
    SpanTimestamps,
    SpanTypes,
    CollectorRESTParams,
    TraceMetadata,
)
from langwatch.utils import (
    SerializableAndPydanticEncoder,
    autoconvert_typed_values,
    capture_exception,
    milliseconds_timestamp,
)
from retry import retry

import langwatch
import contextvars  # Import contextvars module

import functools
import inspect

T = TypeVar("T")


class ContextSpan:
    trace: Optional["ContextTracer"] = None
    context_token: Optional[contextvars.Token[Optional["ContextSpan"]]] = None

    span_id: str
    parent: Optional["ContextSpan"] = None
    _parent_from_context: bool = False
    _capture_input: bool = True
    _capture_output: bool = True
    name: Optional[str] = None
    type: SpanTypes = "span"
    input: Optional[SpanInputOutput] = None
    output: Optional[SpanInputOutput] = None
    error: Optional[Exception] = None
    timestamps: SpanTimestamps
    contexts: Optional[List[RAGChunk]] = None
    model: Optional[str] = None
    params: Optional[LLMSpanParams] = None
    metrics: Optional[LLMSpanMetrics] = None

    def __init__(
        self,
        trace: Optional["ContextTracer"] = None,
        span_id: Optional[str] = None,
        parent: Optional["ContextSpan"] = None,
        capture_input: bool = True,
        capture_output: bool = True,
        name: Optional[str] = None,
        type: SpanTypes = "span",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[List[RAGChunk]] = None,
        model: Optional[str] = None,
        params: Optional[LLMSpanParams] = None,
        metrics: Optional[LLMSpanMetrics] = None,
    ) -> None:
        self.trace = trace
        self.parent = parent
        self._capture_input = capture_input
        self._capture_output = capture_output
        self.update(
            span_id=span_id or f"span_{nanoid.generate()}",
            name=name,
            type=type,
            input=input,
            output=output,
            error=error,
            timestamps=timestamps
            or SpanTimestamps(started_at=milliseconds_timestamp()),
            contexts=contexts,
            model=model,
            params=params,
            metrics=metrics,
        )

    def __enter__(self):
        if self.trace:
            return self

        current_tracer = current_trace_var.get()
        if current_tracer:
            self.trace = current_tracer
            if not self.parent and current_tracer.get_current_span():
                self.parent = current_tracer.get_current_span()
                self._parent_from_context = True
            self.context_token = current_tracer._current_span.set(self)
        else:
            warn("No current trace found, some spans will not be sent to LangWatch")

        return self

    def __exit__(self, _exc_type, exc_value: Optional[Exception], _exc_traceback):
        self.end(error=exc_value)

        # current_tracer = get_current_trace()
        # if not current_tracer:
        #     return

        # current_span = current_tracer.get_current_span()
        # if current_span and current_span.span_id == self.span_id:
        #     current_tracer._current_span = (
        #         self.parent if self._parent_from_context else None
        #     )
        if self.trace and self.context_token:
            self.trace._current_span.reset(self.context_token)

    def __call__(self, func: T) -> T:
        def capture_input(*args, **kwargs):
            if self._capture_input:
                all_args = list(args)
                if len(all_args) == 1:
                    all_args = all_args[0]
                if kwargs and len(kwargs) > 0:
                    all_args = (
                        {str(index): item for index, item in enumerate(args)}
                        if args
                        else {}
                    )
                    if kwargs:
                        all_args.update(kwargs)
                self.input = autoconvert_typed_values(all_args)

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with self:
                    capture_input(*args, **kwargs)
                    output = await func(*args, **kwargs)
                    if self._capture_output:
                        self.output = autoconvert_typed_values(output)
                    return output

            return async_wrapper  # type: ignore
        else:

            @functools.wraps(func)  # type: ignore
            def sync_wrapper(*args, **kwargs):
                with self:
                    capture_input(*args, **kwargs)
                    output = func(*args, **kwargs)  # type: ignore
                    if self._capture_output:
                        self.output = autoconvert_typed_values(output)
                    return output

            return sync_wrapper  # type: ignore

    def update(
        self,
        span_id: Optional[str] = None,
        name: Optional[str] = None,
        type: Optional[SpanTypes] = None,
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[List[RAGChunk]] = None,
        model: Optional[str] = None,
        params: Optional[LLMSpanParams] = None,
        metrics: Optional[LLMSpanMetrics] = None,
    ) -> None:
        if span_id:
            self.span_id = span_id
        if name:
            self.name = name
        if type:
            self.type = type
        if input:
            self.input = input
        if output:
            self.output = output
        if error:
            self.error = error
        if timestamps:
            self.timestamps = timestamps
        if contexts:
            if self.type == "rag":
                self.contexts = contexts
            else:
                warn(
                    "Trying `contexts` on a non-RAG span, this attribute will be ignored for non-RAG spans, please make sure you set the span type to `rag` by using the decorator as @span(type='rag')"
                )
        if model:
            if self.type == "llm":
                self.model = model
            else:
                warn(
                    "Trying `model` on a non-LLM span, this attribute will be ignored for non-LLM spans, please make sure you set the span type to `llm` by using the decorator as @span(type='llm')"
                )
        if params:
            if self.type == "llm":
                self.params = params
            else:
                warn(
                    "Trying `params` on a non-LLM span, this attribute will be ignored for non-LLM spans, please make sure you set the span type to `llm` by using the decorator as @span(type='llm')"
                )
        if metrics:
            if self.type == "llm":
                self.metrics = metrics
            else:
                warn(
                    "Trying `metrics` on a non-LLM span, this attribute will be ignored for non-LLM spans, please make sure you set the span type to `llm` by using the decorator as @span(type='llm')"
                )

    def end(
        self,
        name: Optional[str] = None,
        type: Optional[SpanTypes] = None,
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[List[RAGChunk]] = None,
        model: Optional[str] = None,
        params: Optional[LLMSpanParams] = None,
        metrics: Optional[LLMSpanMetrics] = None,
    ):
        finished_at = milliseconds_timestamp()

        self.update(
            name=name,
            type=type,
            input=input,
            output=output,
            error=error,
            timestamps=timestamps
            or SpanTimestamps(
                started_at=(
                    self.timestamps["started_at"]
                    if "started_at" in self.timestamps
                    else finished_at
                ),
                finished_at=finished_at,
            ),
            contexts=contexts,
            model=model,
            params=params,
            metrics=metrics,
        )

        if not self.trace:
            return

        if self.type == "rag":
            self.trace.append_span(
                RAGSpan(
                    type=self.type,
                    name=self.name,
                    span_id=self.span_id,
                    parent_id=self.parent.span_id if self.parent else None,
                    trace_id=self.trace.trace_id,
                    input=self.input,
                    output=self.output,
                    error=capture_exception(self.error) if self.error else None,
                    timestamps=self.timestamps,
                    contexts=self.contexts or [],
                )
            )
        elif self.type == "llm":
            self.trace.append_span(
                LLMSpan(
                    type=self.type,
                    name=self.name,
                    span_id=self.span_id,
                    parent_id=self.parent.span_id if self.parent else None,
                    trace_id=self.trace.trace_id,
                    input=self.input,
                    output=self.output,
                    error=capture_exception(self.error) if self.error else None,
                    timestamps=self.timestamps,
                    model=self.model,
                    params=self.params,
                    metrics=self.metrics,
                )
            )
        else:
            self.trace.append_span(
                BaseSpan(
                    type=self.type,
                    name=self.name,
                    span_id=self.span_id,
                    parent_id=self.parent.span_id if self.parent else None,
                    trace_id=self.trace.trace_id,
                    input=self.input,
                    output=self.output,
                    error=capture_exception(self.error) if self.error else None,
                    timestamps=self.timestamps,
                )
            )


@deprecated(
    reason="This function is deprecated, please use the @langwatch.span() decorator instead"
)
def create_span(
    name: Optional[str] = None, type: SpanTypes = "span", input: Any = None
):
    return ContextSpan(
        trace=current_trace_var.get() or None,  # type: ignore
        span_id=f"span_{nanoid.generate()}",
        name=name,
        type=type,
        input=input,
    )


@deprecated(
    reason="This function is deprecated, please use the @langwatch.rag_span() decorator instead together with langwatch.get_current_span().update(contexts=[]) to store the context"
)
def capture_rag(
    contexts: List[RAGChunk] = [],
    input: Optional[str] = None,
    name: str = "RetrievalAugmentedGeneration",
):
    return ContextSpan(
        name=name,
        type="rag",
        input={"type": "text", "value": input} if input else None,
        contexts=contexts,
    )


def get_current_trace() -> "ContextTracer":
    current_trace = current_trace_var.get()
    if not current_trace:
        raise ValueError(
            "No current trace found, could not get_current_trace(), make sure you added a @langwatch.trace() decorator on your LLM pipeline top-level function"
        )
    return current_trace


def get_current_span() -> "ContextSpan":
    current_trace = current_trace_var.get()
    if not current_trace:
        raise ValueError(
            "No current trace found, could not get_current_span(), make sure you added a @langwatch.trace() decorator on your LLM pipeline top-level function"
        )
    current_span = current_trace.get_current_span()
    if not current_span:
        raise ValueError(
            "No current span found, could not get_current_span(), make sure you added a @langwatch.span() decorator on your LLM pipeline top-level function"
        )
    return current_span


executor = ThreadPoolExecutor(max_workers=10)
current_trace_var = contextvars.ContextVar[Optional["ContextTracer"]](
    "current_tracer", default=None
)


class ContextTracer:
    sent_once = False
    scheduled_send: Optional[Future[None]] = None
    _current_span = contextvars.ContextVar[Optional[ContextSpan]](
        "current_span", default=None
    )
    context_token: Optional[contextvars.Token[Optional["ContextTracer"]]] = None

    trace_id: str
    metadata: Optional[TraceMetadata] = None

    def __init__(
        self,
        trace_id: Optional[str] = None,
        metadata: Optional[TraceMetadata] = None,
    ):
        self.spans: Dict[str, Span] = {}
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"
        self.metadata = metadata

    def __enter__(self):
        self.context_token = current_trace_var.set(self)
        return self

    def __exit__(self, _type, _value, _traceback):
        self.deferred_send_spans()
        if self.context_token:
            current_trace_var.reset(self.context_token)

    def __call__(self, func: T) -> T:
        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with self:
                    return await func(*args, **kwargs)

            return async_wrapper  # type: ignore
        else:

            @functools.wraps(func)  # type: ignore
            def sync_wrapper(*args, **kwargs):
                with self:
                    return func(*args, **kwargs)  # type: ignore

            return sync_wrapper  # type: ignore

    def update(
        self, trace_id: Optional[str] = None, metadata: Optional[TraceMetadata] = None
    ):
        if trace_id:
            self.trace_id = trace_id
        if metadata:
            self.metadata = metadata

    def deferred_send_spans(self):
        self._add_finished_at_to_missing_spans()

        if "PYTEST_CURRENT_TEST" in os.environ:
            # Keep on the same thread for tests
            self.send_spans()
            return

        def run_in_thread():
            time.sleep(1)  # wait for other spans to be added
            self.sent_once = True
            self.send_spans()

        if self.scheduled_send and not self.scheduled_send.done():
            self.scheduled_send.cancel()

        self.scheduled_send = executor.submit(run_in_thread)

    def send_spans(self):
        send_spans(
            CollectorRESTParams(
                trace_id=self.trace_id,
                metadata=self.metadata,
                spans=list(self.spans.values()),
            )
        )

    def append_span(self, span: Span):
        span["span_id"] = span.get("span_id", f"span_{nanoid.generate()}")
        self.spans[span["span_id"]] = span
        if self.sent_once:
            self.deferred_send_spans()  # send again if needed

    def get_parent_id(self):
        current_span = self.get_current_span()
        if current_span:
            return current_span.span_id
        return None

    def get_current_span(self):
        return self._current_span.get()

    # Some spans may have their timestamps overwritten, never setting the finished_at, so we do it here as a fallback
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
        warn(
            "LANGWATCH_API_KEY is not set, LLMs traces will not be sent, go to https://langwatch.ai to set it up"
        )
        return
    import json

    # TODO: replace this with httpx, don't forget the custom SerializableAndPydanticEncoder encoder
    response = requests.post(
        langwatch.endpoint + "/api/collector",
        data=json.dumps(data, cls=SerializableAndPydanticEncoder),
        headers={
            "X-Auth-Token": str(langwatch.api_key),
            "Content-Type": "application/json",
        },
    )
    if response.status_code == 429:
        json = response.json()
        if "message" in json and "ERR_PLAN_LIMIT" in json["message"]:
            warn(json["message"])
        else:
            warn("Rate limit exceeded, dropping message from being sent to LangWatch")
    else:
        response.raise_for_status()


trace = ContextTracer
span = ContextSpan
