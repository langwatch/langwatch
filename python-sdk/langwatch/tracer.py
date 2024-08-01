from importlib.metadata import version
import os
from concurrent.futures import Future, ThreadPoolExecutor
import time
from types import ModuleType
from typing import Any, Callable, Dict, List, Optional, Type, TypeVar, Union, cast
from uuid import UUID
from warnings import warn
from deprecated import deprecated
import httpx

import nanoid
import requests
from langwatch.logger import get_logger
from langwatch.types import (
    BaseSpan,
    ChatMessage,
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
    SerializableWithStringFallback,
    autoconvert_rag_contexts,
    autoconvert_typed_values,
    capture_exception,
    milliseconds_timestamp,
    reduce_payload_size,
)
from retry import retry

import langwatch
import contextvars  # Import contextvars module

import functools
import inspect

try:
    from openai import (
        OpenAI,
        AsyncOpenAI,
        AzureOpenAI,
        AsyncAzureOpenAI,
    )
except ImportError:
    pass

T = TypeVar("T", bound=Callable[..., Any])


def get_version():
    """Retrieves the version of the current library."""
    try:
        return version("langwatch")
    except Exception:
        return "unknown"


class ContextSpan:
    trace: Optional["ContextTrace"] = None
    context_token: Optional[contextvars.Token[Optional["ContextSpan"]]] = None
    span: Type["ContextSpan"]

    span_id: Union[str, UUID]
    parent: Optional["ContextSpan"] = None
    _parent_from_context: bool = False
    _capture_input: bool = True
    _capture_output: bool = True
    _ignore_missing_trace_warning: bool = False
    name: Optional[str] = None
    type: SpanTypes = "span"
    input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None
    output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None
    error: Optional[Exception] = None
    timestamps: SpanTimestamps
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None
    model: Optional[str] = None
    params: Optional[LLMSpanParams] = None
    metrics: Optional[LLMSpanMetrics] = None

    def __init__(
        self,
        trace: Optional["ContextTrace"] = None,
        span_id: Optional[Union[str, UUID]] = None,
        parent: Optional["ContextSpan"] = None,
        capture_input: bool = True,
        capture_output: bool = True,
        name: Optional[str] = None,
        type: SpanTypes = "span",
        input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
        model: Optional[str] = None,
        params: Optional[LLMSpanParams] = None,
        metrics: Optional[LLMSpanMetrics] = None,
        ignore_missing_trace_warning: bool = False,
    ) -> None:
        self.trace = trace
        self.parent = parent
        self._capture_input = capture_input
        self._capture_output = capture_output
        self._ignore_missing_trace_warning = ignore_missing_trace_warning
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
        self.span = cast(
            Type["ContextSpan"],
            lambda **kwargs: ContextSpan(trace=self.trace, parent=self, **kwargs),
        )

    def __enter__(self):
        current_trace = current_trace_var.get() or self.trace
        if current_trace:
            if not self.trace:
                self.trace = current_trace

            if self.trace == current_trace:
                if not self.parent and current_trace.get_current_span():
                    self.parent = current_trace.get_current_span()
                    self._parent_from_context = True
                self.context_token = current_trace.set_current_span(self)
        elif not self._ignore_missing_trace_warning:
            warn("No current trace found, some spans will not be sent to LangWatch")

        return self

    def __exit__(
        self, _exc_type=None, exc_value: Optional[Exception] = None, _exc_traceback=None
    ):
        self.end(error=exc_value)

        if self.trace:
            self.trace.reset_current_span(self.context_token)
            self.context_token = None

    def __call__(self, func: T) -> T:
        span_kwargs = {
            "trace": None,
            "span_id": None,
            "parent": None,
            "capture_input": self._capture_input,
            "capture_output": self._capture_output,
            "name": self.name,
            "type": self.type,
            "input": self.input,
            "output": self.output,
            "error": self.error,
            "timestamps": None,
            "contexts": self.contexts,
            "model": self.model,
            "params": self.params,
            "metrics": self.metrics,
        }

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with ContextSpan(**span_kwargs) as span:
                    span._capture_name_and_input(func, *args, **kwargs)
                    output = await func(*args, **kwargs)
                    span._capture_output_and_maybe_name(func, output)
                    return output

            return async_wrapper  # type: ignore
        else:

            @functools.wraps(func)  # type: ignore
            def sync_wrapper(*args, **kwargs):
                with ContextSpan(**span_kwargs) as span:
                    span._capture_name_and_input(func, *args, **kwargs)
                    output = func(*args, **kwargs)  # type: ignore
                    span._capture_output_and_maybe_name(func, output)
                    return output

            return sync_wrapper  # type: ignore

    def _capture_name_and_input(self, func, *args, **kwargs):
        if self.type != "llm":
            self.name = func.__name__
        if self._capture_input:
            sig = inspect.signature(func)
            parameters = list(sig.parameters.values())

            all_args = {
                str(parameter.name): value for parameter, value in zip(parameters, args)
            }
            # Skip self parameters because it doesn't really help with debugging, becomes just noise
            if (
                "self" in all_args
                and len(all_args) > 0
                and parameters[0].name == "self"
            ):
                self_ = all_args["self"]
                try:
                    self.name = f"{self_.__class__.__name__}.{func.__name__}"
                except:
                    pass
                del all_args["self"]

            if kwargs and len(kwargs) > 0:
                if kwargs:
                    all_args.update(kwargs)

            if len(all_args) == 0:
                return

            self.input = autoconvert_typed_values(all_args)

    def _capture_output_and_maybe_name(self, func, output):
        if not self.output and self._capture_output:
            self.output = autoconvert_typed_values(output)
        if self.type == "llm" and not self.model:
            self.name = func.__name__

    def update(
        self,
        span_id: Optional[Union[str, UUID]] = None,
        name: Optional[str] = None,
        type: Optional[SpanTypes] = None,
        input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
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
        input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
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
                    span_id=str(self.span_id),
                    parent_id=str(self.parent.span_id) if self.parent else None,
                    trace_id=str(self.trace.trace_id),
                    input=(
                        reduce_payload_size(autoconvert_typed_values(self.input))
                        if self.input
                        else None
                    ),
                    output=(
                        reduce_payload_size(autoconvert_typed_values(self.output))
                        if self.output
                        else None
                    ),
                    error=(
                        reduce_payload_size(capture_exception(self.error))
                        if self.error
                        else None
                    ),
                    timestamps=self.timestamps,
                    contexts=reduce_payload_size(
                        autoconvert_rag_contexts(self.contexts or [])
                    ),
                )
            )
        elif self.type == "llm":
            self.trace.append_span(
                LLMSpan(
                    type=self.type,
                    name=self.name,
                    span_id=str(self.span_id),
                    parent_id=str(self.parent.span_id) if self.parent else None,
                    trace_id=str(self.trace.trace_id),
                    input=(
                        reduce_payload_size(autoconvert_typed_values(self.input))
                        if self.input
                        else None
                    ),
                    output=(
                        reduce_payload_size(autoconvert_typed_values(self.output))
                        if self.output
                        else None
                    ),
                    error=(
                        reduce_payload_size(capture_exception(self.error))
                        if self.error
                        else None
                    ),
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
                    span_id=str(self.span_id),
                    parent_id=str(self.parent.span_id) if self.parent else None,
                    trace_id=str(self.trace.trace_id),
                    input=(
                        reduce_payload_size(autoconvert_typed_values(self.input))
                        if self.input
                        else None
                    ),
                    output=(
                        reduce_payload_size(autoconvert_typed_values(self.output))
                        if self.output
                        else None
                    ),
                    error=(
                        reduce_payload_size(capture_exception(self.error))
                        if self.error
                        else None
                    ),
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


def get_current_trace() -> "ContextTrace":
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
current_trace_var = contextvars.ContextVar[Optional["ContextTrace"]](
    "current_trace", default=None
)


class ContextTrace:
    sent_once = False
    scheduled_send: Optional[Future[None]] = None
    _current_span = contextvars.ContextVar[Optional[ContextSpan]](
        "current_span", default=None
    )
    _current_span_global: Optional[ContextSpan] = (
        None  # Fallback for backing up edge cases like langchain
    )
    context_token: Optional[contextvars.Token[Optional["ContextTrace"]]] = None

    trace_id: Union[str, UUID]
    metadata: TraceMetadata = {}
    expected_output: Optional[str] = None
    span: Type[ContextSpan]
    root_span: ContextSpan

    _capture_input: bool = True
    _capture_output: bool = True

    api_key: Optional[str] = None

    def __init__(
        self,
        trace_id: Optional[Union[str, UUID]] = None,
        metadata: Optional[TraceMetadata] = None,
        expected_output: Optional[str] = None,
        api_key: Optional[str] = None,
        # Span constructor parameters
        span_id: Optional[str] = None,
        capture_input: bool = True,
        capture_output: bool = True,
        name: Optional[str] = None,
        type: SpanTypes = "span",
        input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
        model: Optional[str] = None,
        params: Optional[LLMSpanParams] = None,
        metrics: Optional[LLMSpanMetrics] = None,
    ):
        self.api_key = api_key or langwatch.api_key
        self.spans: Dict[str, Span] = {}

        self._capture_input = capture_input
        self._capture_output = capture_output
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"
        self.metadata = metadata or {}
        self.expected_output = expected_output
        self.metadata.update({"sdk_version": get_version(), "sdk_language": "python"})
        self.span = cast(
            Type[ContextSpan], lambda **kwargs: ContextSpan(trace=self, **kwargs)
        )
        self.root_span = self.span(
            span_id=span_id,
            name=name,
            type=type,
            input=input,
            output=output,
            error=error,
            timestamps=timestamps,
            contexts=contexts,
            model=model,
            params=params,
            metrics=metrics,
        )

    def __enter__(self):
        get_logger().debug(f"Entered trace {self.trace_id}")
        self.context_token = current_trace_var.set(self)
        self.root_span.__enter__()
        return self

    def __exit__(self, _type, _value, _traceback):
        get_logger().debug(f"Exiting trace {self.trace_id}")
        self.deferred_send_spans()
        self.root_span.__exit__(_type, _value, _traceback)
        if self.context_token:
            current_trace_var.reset(self.context_token)
            self.context_token = None

    def __call__(self, func: T) -> T:
        trace_kwargs = {
            "trace_id": None,
            "metadata": self.metadata,
            "api_key": self.api_key,
            # Span constructor parameters
            "capture_input": self._capture_input,
            "capture_output": self._capture_output,
            "name": self.root_span.name,
            "type": self.root_span.type,
            "input": self.root_span.input,
            "output": self.root_span.output,
            "error": self.root_span.error,
            "timestamps": None,
            "contexts": self.root_span.contexts,
            "model": self.root_span.model,
            "params": self.root_span.params,
            "metrics": self.root_span.metrics,
        }

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with ContextTrace(**trace_kwargs) as trace:
                    trace.root_span._capture_name_and_input(func, *args, **kwargs)
                    output = await func(*args, **kwargs)
                    trace.root_span._capture_output_and_maybe_name(func, output)

            return async_wrapper  # type: ignore
        else:

            @functools.wraps(func)  # type: ignore
            def sync_wrapper(*args, **kwargs):
                with ContextTrace(**trace_kwargs) as trace:
                    trace.root_span._capture_name_and_input(func, *args, **kwargs)
                    output = func(*args, **kwargs)  # type: ignore
                    trace.root_span._capture_output_and_maybe_name(func, output)
                    return output

            return sync_wrapper  # type: ignore

    def update(
        self,
        trace_id: Optional[Union[str, UUID]] = None,
        metadata: Optional[TraceMetadata] = None,
        expected_output: Optional[str] = None,
        # root span update
        span_id: Optional[Union[str, UUID]] = None,
        name: Optional[str] = None,
        type: Optional[SpanTypes] = None,
        input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
        model: Optional[str] = None,
        params: Optional[LLMSpanParams] = None,
        metrics: Optional[LLMSpanMetrics] = None,
    ):
        if trace_id:
            self.trace_id = trace_id
        if metadata:
            self.metadata.update(metadata)
        if expected_output:
            self.expected_output = expected_output

        self.root_span.update(
            span_id=span_id,
            name=name,
            type=type,
            input=input,
            output=output,
            error=error,
            timestamps=timestamps,
            contexts=contexts,
            model=model,
            params=params,
            metrics=metrics,
        )

    def deferred_send_spans(self):
        get_logger().debug(f"Scheduling for sending trace {self.trace_id} in 1s")
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
                trace_id=str(self.trace_id),
                metadata=self.metadata,
                spans=list(self.spans.values()),
                expected_output=self.expected_output,
            ),
            api_key=self.api_key,
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

    def get_current_span(self) -> Optional[ContextSpan]:
        return self._current_span_global or self._current_span.get()

    def set_current_span(self, span: ContextSpan):
        token = self._current_span.set(span)
        self._current_span_global = span

        return token

    def reset_current_span(
        self, token: Optional[contextvars.Token[Optional["ContextSpan"]]]
    ):
        try:
            if not token:
                raise ValueError("No token provided")
            self._current_span.reset(token)
            self._current_span_global = self._current_span.get()

        # Fallback to manually set the parent back in case the span is ended in a different context and token does not work
        except ValueError:
            current_span = self.get_current_span()
            if current_span and current_span.parent:
                self.set_current_span(current_span.parent)
            else:
                self._current_span.set(None)
                self._current_span_global = None

    # Some spans may have their timestamps overwritten, never setting the finished_at, so we do it here as a fallback
    def _add_finished_at_to_missing_spans(self):
        for span in self.spans.values():
            if "timestamps" in span and (
                "finished_at" not in span["timestamps"]
                or span["timestamps"]["finished_at"] == None
            ):
                span["timestamps"]["finished_at"] = milliseconds_timestamp()

    def get_langchain_callback(self):
        import langwatch.langchain  # import dynamically here instead of top-level because users might not have langchain installed

        return langwatch.langchain.LangChainTracer(trace=self)

    def autotrack_openai_calls(
        self, client: Union["OpenAI", "AsyncOpenAI", "AzureOpenAI", "AsyncAzureOpenAI"]
    ):
        import langwatch.openai  # import dynamically here instead of top-level because, believe it or not, users might not have openai installed

        langwatch.openai.OpenAITracer(trace=self, client=client)

    def autotrack_litellm_calls(self, client: ModuleType):
        import langwatch.litellm  # import dynamically here instead of top-level because users might not have litellm installed

        langwatch.litellm.LiteLLMPatch(trace=self, client=client)

    def autotrack_dspy(self):
        langwatch.dspy.tracer(trace=self)

    def share(self):
        with httpx.Client() as client:
            response = client.post(
                f"{langwatch.endpoint}/api/trace/{self.trace_id}/share",
                headers={"X-Auth-Token": str(self.api_key)},
            )
            response.raise_for_status()
            path = response.json()["path"]
            return f"{langwatch.endpoint}{path}"

    def unshare(self):
        with httpx.Client() as client:
            response = client.post(
                f"{langwatch.endpoint}/api/trace/{self.trace_id}/unshare",
                headers={"X-Auth-Token": str(self.api_key)},
            )
            response.raise_for_status()


@retry(tries=5, delay=0.5, backoff=3)
def send_spans(data: CollectorRESTParams, api_key: Optional[str] = None):
    import json

    get_logger().debug(
        f"Sending trace: {json.dumps(data, cls=SerializableWithStringFallback, indent=2)}"
    )

    api_key = api_key or langwatch.api_key
    if not api_key:
        warn(
            "LANGWATCH_API_KEY is not set, LLMs traces will not be sent, go to https://langwatch.ai to set it up"
        )
        return

    # TODO: replace this with httpx, don't forget the custom SerializableWithStringFallback encoder
    response = requests.post(
        langwatch.endpoint + "/api/collector",
        data=json.dumps(data, cls=SerializableWithStringFallback),
        headers={
            "X-Auth-Token": str(api_key),
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
        if response.status_code >= 300 and response.status_code < 500:
            try:
                json = response.json()
                if "message" in json:
                    message = json["message"]
                    warn(f"LangWatch returned an error: {message}")
                else:
                    warn(f"LangWatch returned an error: {response.content}")
            except:
                warn(f"LangWatch returned an error: {response.content}")
        response.raise_for_status()


trace = ContextTrace
span = ContextSpan
