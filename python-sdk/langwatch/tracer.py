import functools
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
import time
from typing import Any, Dict, List, Literal, Optional, TypeVar
from warnings import warn
from deprecated import deprecated

import nanoid
from pydantic import BaseModel
import requests
from langwatch.types import (
    BaseSpan,
    ErrorCapture,
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


class ContextSpan(BaseModel):
    trace: Optional["BaseContextTracer"] = None

    span_id: str
    parent: Optional["ContextSpan"] = None
    _parent_from_context: bool = False
    _capture_input: bool = True
    _capture_output: bool = True
    name: Optional[str]
    type: SpanTypes
    input: Optional[SpanInputOutput] = None
    output: Optional[SpanInputOutput] = None
    error: Optional[Exception] = None
    timestamps: SpanTimestamps

    def __init__(
        self,
        trace: Optional["BaseContextTracer"] = None,
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
        )

    def __enter__(self):
        if self.trace:
            return self

        current_tracer = current_tracer_var.get()
        if current_tracer:
            self.trace = current_tracer
            if not self.parent and current_tracer.current_span:
                self.parent = current_tracer.current_span
                self._parent_from_context = True
            current_tracer.current_span = self
        else:
            warn("No current trace found, some spans will not be sent to LangWatch")

        return self

    def __exit__(self, _exc_type, exc_value: Optional[Exception], _exc_traceback):
        self.end(error=exc_value)

        current_tracer = get_current_trace()
        if (
            current_tracer
            and current_tracer.current_span
            and current_tracer.current_span.span_id == self.span_id
        ):
            current_tracer.current_span = (
                self.parent if self._parent_from_context else None
            )

    def __call__(self, func):
        def wrapper(*args, **kwargs):
            if self._capture_input:
                all_args = (
                    {str(index): item for index, item in enumerate(args)}
                    if args
                    else {}
                )
                if kwargs:
                    all_args.update(kwargs)
                self.input = autoconvert_typed_values(all_args)

            with self:
                output = func(*args, **kwargs)
                if self._capture_output:
                    self.output = autoconvert_typed_values(output)
                return output

        return wrapper

    def update(
        self,
        span_id: Optional[str] = None,
        name: Optional[str] = None,
        type: SpanTypes = "span",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
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

    def end(
        self,
        name: Optional[str] = None,
        type: SpanTypes = "span",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
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
        )

        if not self.trace:
            return

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


class ContextRAGSpan(ContextSpan):
    type: Literal["rag"] = "rag"
    contexts: List[RAGChunk]

    def __init__(
        self,
        trace: Optional["BaseContextTracer"] = None,
        span_id: Optional[str] = None,
        parent: Optional["ContextSpan"] = None,
        capture_input: bool = True,
        capture_output: bool = True,
        name: Optional[str] = None,
        type: Literal["rag"] = "rag",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: List[RAGChunk] = [],
    ) -> None:
        super().__init__(
            trace=trace,
            capture_input=capture_input,
            capture_output=capture_output,
            parent=parent,
        )
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
        )

    def update(
        self,
        span_id: Optional[str] = None,
        name: Optional[str] = None,
        type: Literal["rag"] = "rag",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: List[RAGChunk] = [],
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
            self.contexts = contexts

    def end(
        self,
        name: Optional[str] = None,
        type: Literal["rag"] = "rag",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: List[RAGChunk] = [],
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
        )

        if not self.trace:
            return

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
                contexts=self.contexts,
            )
        )


class ContextLLMSpan(ContextSpan):
    type: Literal["llm"] = "llm"
    model: str
    params: Optional[LLMSpanParams]
    metrics: Optional[LLMSpanMetrics]

    def __init__(
        self,
        trace: Optional["BaseContextTracer"] = None,
        span_id: Optional[str] = None,
        parent: Optional["ContextSpan"] = None,
        capture_input: bool = True,
        capture_output: bool = True,
        name: Optional[str] = None,
        type: Literal["llm"] = "llm",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        model: Optional[str] = None,
        params: Optional[LLMSpanParams] = None,
        metrics: Optional[LLMSpanMetrics] = None,
    ) -> None:
        super().__init__(
            trace=trace,
            capture_input=capture_input,
            capture_output=capture_output,
            parent=parent,
        )
        self.update(
            span_id=span_id or f"span_{nanoid.generate()}",
            name=name,
            type=type,
            input=input,
            output=output,
            error=error,
            timestamps=timestamps
            or SpanTimestamps(started_at=milliseconds_timestamp()),
            model=model,
            params=params,
            metrics=metrics,
        )

    def update(
        self,
        span_id: Optional[str] = None,
        name: Optional[str] = None,
        type: Literal["llm"] = "llm",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
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
        if model:
            self.model = model
        if params:
            self.params = params
        if metrics:
            self.metrics = metrics

    def end(
        self,
        name: Optional[str] = None,
        type: Literal["llm"] = "llm",
        input: Optional[SpanInputOutput] = None,
        output: Optional[SpanInputOutput] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
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
            model=model,
            params=params,
            metrics=metrics,
        )

        if not self.trace:
            return

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


@deprecated(
    reason="This function is deprecated, please use the @langwatch.span() decorator instead"
)
def create_span(
    name: Optional[str] = None, type: SpanTypes = "span", input: Any = None
):
    return ContextSpan(
        trace=get_current_trace(),  # type: ignore
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
    return ContextRAGSpan(
        name=name,
        input={"type": "text", "value": input} if input else None,
        contexts=contexts,
    )


def get_current_trace():
    return current_tracer_var.get()


def get_current_span():
    current_trace = current_tracer_var.get()
    if not current_trace:
        raise ValueError(
            "No current trace found, could not get_current_span(), make sure you added a @langwatch.trace() decorator on your LLM pipeline top-level function"
        )
    return current_trace.current_span


executor = ThreadPoolExecutor(max_workers=10)


class BaseContextTracer:
    sent_once = False
    scheduled_send: Optional[Future[None]] = None
    current_span: Optional[ContextSpan] = None

    def __init__(
        self,
        trace_id: Optional[str],
        metadata: Optional[TraceMetadata],
    ):
        self.spans: Dict[str, Span] = {}
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"
        self.metadata = metadata

    def __enter__(self):
        self.token = current_tracer_var.set(self)
        return self

    def __exit__(self, _type, _value, _traceback):
        self.delayed_send_spans()
        current_tracer_var.reset(self.token)

    def delayed_send_spans(self):
        self._add_finished_at_to_missing_spans()

        if "PYTEST_CURRENT_TEST" in os.environ:
            # Keep on the same thread for tests
            self.send_spans_sync()
            return

        def run_in_thread():
            time.sleep(1)  # wait for other spans to be added
            self.sent_once = True
            self.send_spans_sync()

        if self.scheduled_send and not self.scheduled_send.done():
            self.scheduled_send.cancel()

        self.scheduled_send = executor.submit(run_in_thread)

    def send_spans_sync(self):
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
            self.delayed_send_spans()  # send again if needed

    def get_parent_id(self):
        if self.current_span:
            return self.current_span.span_id
        return None

    # Some spans may have their timestamps overwritten, never setting the finished_at, so we do it here as a fallback
    def _add_finished_at_to_missing_spans(self):
        for span in self.spans.values():
            if "timestamps" in span and (
                "finished_at" not in span["timestamps"]
                or span["timestamps"]["finished_at"] == None
            ):
                span["timestamps"]["finished_at"] = milliseconds_timestamp()


current_tracer_var = contextvars.ContextVar[Optional[BaseContextTracer]](
    "current_tracer", default=None
)


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


span = ContextSpan
rag_span = ContextRAGSpan
llm_span = ContextLLMSpan
