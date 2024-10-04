import copy
from importlib.metadata import version
import os
from concurrent.futures import Future, ThreadPoolExecutor
import time
from types import ModuleType
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Type,
    TypeVar,
    Union,
    cast,
)
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
    Conversation,
    Evaluation,
    EvaluationResult,
    EvaluationTimestamps,
    LLMSpan,
    Money,
    MoneyDict,
    SpanMetrics,
    SpanParams,
    RAGChunk,
    RAGSpan,
    Span,
    SpanInputOutput,
    SpanTimestamps,
    SpanTypes,
    CollectorRESTParams,
    TraceMetadata,
    TypedValueEvaluationResult,
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
    params: Optional[SpanParams] = None
    metrics: Optional[SpanMetrics] = None

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
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
        ignore_missing_trace_warning: bool = False,
    ) -> None:
        self.trace = trace
        self.parent = parent
        self._capture_input = capture_input
        self._capture_output = capture_output
        self._ignore_missing_trace_warning = ignore_missing_trace_warning
        self.timestamps = SpanTimestamps(started_at=milliseconds_timestamp())
        self.update(
            span_id=span_id or f"span_{nanoid.generate()}",
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

        if inspect.isasyncgenfunction(func):

            @functools.wraps(func)
            async def async_gen_wrapper(*args, **kwargs):
                with ContextSpan(**span_kwargs) as span:
                    span._capture_name_and_input(func, *args, **kwargs)
                    items = []
                    async for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    span._capture_output_and_maybe_name(func, output)

            return async_gen_wrapper  # type: ignore
        elif inspect.isgeneratorfunction(func):

            @functools.wraps(func)
            def sync_gen_wrapper(*args, **kwargs):
                with ContextSpan(**span_kwargs) as span:
                    span._capture_name_and_input(func, *args, **kwargs)
                    items = []
                    for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    span._capture_output_and_maybe_name(func, output)

            return sync_gen_wrapper  # type: ignore

        elif inspect.iscoroutinefunction(func):

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
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
    ) -> None:
        if span_id:
            self.span_id = span_id
        if name:
            self.name = name
        if type:
            self.type = type
        if input:
            # Avoid late mutations after capturing the value
            self.input = copy.deepcopy(input)
        if output:
            # Avoid late mutations after capturing the value
            self.output = copy.deepcopy(output)
        if error:
            self.error = error
        if timestamps:
            if self.timestamps:
                self.timestamps = {**self.timestamps, **timestamps}
            else:
                self.timestamps = timestamps
        if contexts:
            if self.type == "rag":
                # Avoid late mutations after capturing the value
                self.contexts = copy.deepcopy(contexts)
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
            # Avoid late mutations after capturing the value
            params = copy.deepcopy(params)
            if self.params:
                self.params = {**self.params, **params}
            else:
                self.params = params
        if metrics:
            # Avoid late mutations after capturing the value
            metrics = copy.deepcopy(metrics)
            if self.metrics:
                self.metrics = {**self.metrics, **metrics}
            else:
                self.metrics = metrics

    def add_evaluation(
        self,
        *,
        evaluation_id: Optional[str] = None,
        name: str,
        type: Optional[str] = None,
        is_guardrail: Optional[bool] = None,
        status: Literal["processed", "skipped", "error"] = "processed",
        passed: Optional[bool] = None,
        score: Optional[float] = None,
        label: Optional[str] = None,
        details: Optional[str] = None,
        cost: Optional[Union[Money, MoneyDict, float]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[EvaluationTimestamps] = None,
    ):
        if not self.trace:
            raise ValueError("No trace found, could not add evaluation to span")

        self.trace.add_evaluation(
            evaluation_id=evaluation_id,
            span=self,
            name=name,
            type=type,
            is_guardrail=is_guardrail,
            status=status,
            passed=passed,
            score=score,
            label=label,
            details=details,
            cost=cost,
            error=error,
            timestamps=timestamps,
        )

    def evaluate(
        self,
        slug: str,
        name: Optional[str] = None,
        input: Optional[str] = None,
        output: Optional[str] = None,
        expected_output: Optional[str] = None,
        contexts: Union[List[RAGChunk], List[str]] = [],
        conversation: Conversation = [],
        settings: Optional[dict] = None,
        as_guardrail: bool = False,
    ):
        return langwatch.evaluations.evaluate(
            span=self,
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
            settings=settings,
            as_guardrail=as_guardrail,
        )

    async def async_evaluate(
        self,
        slug: str,
        name: Optional[str] = None,
        input: Optional[str] = None,
        output: Optional[str] = None,
        expected_output: Optional[str] = None,
        contexts: Union[List[RAGChunk], List[str]] = [],
        conversation: Conversation = [],
        settings: Optional[dict] = None,
        as_guardrail: bool = False,
    ):
        return await langwatch.evaluations.async_evaluate(
            span=self,
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
            settings=settings,
            as_guardrail=as_guardrail,
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
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
    ):
        finished_at = milliseconds_timestamp()

        self.update(
            name=name,
            type=type,
            input=input,
            output=output,
            error=error,
            timestamps={
                "finished_at": finished_at,
                **(timestamps or {}),
            },
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
                    params=self.params,
                    metrics=self.metrics,
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
    root_span: Optional[ContextSpan] = None
    evaluations: List[Evaluation] = []

    _capture_input: bool = True
    _capture_output: bool = True
    _skip_root_span: bool = False

    api_key: Optional[str] = None
    _force_sync: bool = False

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
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
        evaluations: Optional[List[Evaluation]] = None,
        skip_root_span: bool = False,
    ):
        self.api_key = api_key or langwatch.api_key
        self.spans: Dict[str, Span] = {}

        self._capture_input = capture_input
        self._capture_output = capture_output
        self._skip_root_span = skip_root_span

        self.trace_id = trace_id or f"trace_{nanoid.generate()}"
        self.metadata = metadata or {}
        self.expected_output = expected_output
        self.metadata.update({"sdk_version": get_version(), "sdk_language": "python"})
        self.evaluations = evaluations or []
        self.span = cast(
            Type[ContextSpan], lambda **kwargs: ContextSpan(trace=self, **kwargs)
        )
        if not skip_root_span:
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
        if self.root_span:
            self.root_span.__enter__()
        return self

    def __exit__(self, _type, _value, _traceback):
        get_logger().debug(f"Exiting trace {self.trace_id}")
        self.deferred_send_spans()
        if self.root_span:
            self.root_span.__exit__(_type, _value, _traceback)
        if self.context_token:
            try:
                current_trace_var.reset(self.context_token)
            except ValueError:
                pass
            self.context_token = None

    def __call__(self, func: T) -> T:
        trace_kwargs = {
            "trace_id": None,
            "metadata": self.metadata,
            "api_key": self.api_key,
            # Span constructor parameters
            "capture_input": self._capture_input,
            "capture_output": self._capture_output,
            "skip_root_span": self._skip_root_span,
        }

        if self.root_span:
            trace_kwargs.update(
                {
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
            )

        if inspect.isasyncgenfunction(func):

            @functools.wraps(func)
            async def async_gen_wrapper(*args, **kwargs):
                with ContextTrace(**trace_kwargs) as trace:
                    if trace.root_span:
                        trace.root_span._capture_name_and_input(func, *args, **kwargs)
                    items = []
                    async for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    if trace.root_span:
                        trace.root_span._capture_output_and_maybe_name(func, output)

            return async_gen_wrapper  # type: ignore
        elif inspect.isgeneratorfunction(func):

            @functools.wraps(func)
            def sync_gen_wrapper(*args, **kwargs):
                with ContextTrace(**trace_kwargs) as trace:
                    if trace.root_span:
                        trace.root_span._capture_name_and_input(func, *args, **kwargs)
                    items = []
                    for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    if trace.root_span:
                        trace.root_span._capture_output_and_maybe_name(func, output)

            return sync_gen_wrapper  # type: ignore
        elif inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with ContextTrace(**trace_kwargs) as trace:
                    if trace.root_span:
                        trace.root_span._capture_name_and_input(func, *args, **kwargs)
                    output = await func(*args, **kwargs)
                    if trace.root_span:
                        trace.root_span._capture_output_and_maybe_name(func, output)
                    return output

            return async_wrapper  # type: ignore
        else:

            @functools.wraps(func)  # type: ignore
            def sync_wrapper(*args, **kwargs):
                with ContextTrace(**trace_kwargs) as trace:
                    if trace.root_span:
                        trace.root_span._capture_name_and_input(func, *args, **kwargs)
                    output = func(*args, **kwargs)  # type: ignore
                    if trace.root_span:
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
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
        evaluations: Optional[List[Evaluation]] = None,
    ):
        if trace_id:
            self.trace_id = trace_id
        if metadata:
            self.metadata.update(metadata)
        if expected_output:
            self.expected_output = expected_output
        if evaluations:
            # Avoid late mutations after capturing the value
            self.evaluations = copy.deepcopy(evaluations)

        if self.root_span:
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

    def add_evaluation(
        self,
        *,
        evaluation_id: Optional[str] = None,
        span: Optional[ContextSpan] = None,
        name: str,
        type: Optional[str] = None,
        is_guardrail: Optional[bool] = None,
        status: Literal["processed", "skipped", "error"] = "processed",
        passed: Optional[bool] = None,
        score: Optional[float] = None,
        label: Optional[str] = None,
        details: Optional[str] = None,
        cost: Optional[Union[Money, MoneyDict, float]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[EvaluationTimestamps] = None,
    ):
        current_evaluation_index = [
            i
            for i, e in enumerate(self.evaluations)
            if evaluation_id
            and "evaluation_id" in e
            and e["evaluation_id"] == evaluation_id
        ]
        current_evaluation_index = (
            current_evaluation_index[0] if len(current_evaluation_index) > 0 else None
        )
        current_evaluation = (
            self.evaluations[current_evaluation_index]
            if current_evaluation_index
            else None
        )

        evaluation_result = EvaluationResult(
            status=status,
        )
        if passed is not None:
            evaluation_result["passed"] = passed
        if score is not None:
            evaluation_result["score"] = score
        if label is not None:
            evaluation_result["label"] = label
        if details is not None:
            evaluation_result["details"] = details
        if cost is not None:
            if isinstance(cost, Money):
                evaluation_result["cost"] = {
                    "currency": cost.currency,
                    "amount": cost.amount,
                }
            elif isinstance(cost, float) or isinstance(cost, int):
                evaluation_result["cost"] = {"currency": "USD", "amount": cost}
            else:
                evaluation_result["cost"] = cost

        if not span:
            span = self.span(type="evaluation")
        if span.type != "evaluation":
            span = span.span(type="evaluation")
        span.update(
            name=name,
            output=TypedValueEvaluationResult(
                type="evaluation_result",
                value=evaluation_result,
            ),
            error=error,
            timestamps=(
                SpanTimestamps(
                    started_at=(
                        timestamps["started_at"]
                        if "started_at" in timestamps and timestamps["started_at"]
                        else cast(int, None)
                    ),
                    finished_at=(
                        timestamps["finished_at"]
                        if "finished_at" in timestamps and timestamps["finished_at"]
                        else cast(int, None)
                    ),
                )
                if timestamps
                else None
            ),
        )
        if "cost" in evaluation_result and evaluation_result["cost"]:
            span.update(metrics=SpanMetrics(cost=evaluation_result["cost"]["amount"]))
        span.end()

        evaluation = Evaluation(
            evaluation_id=evaluation_id or f"eval_{nanoid.generate()}",
            span_id=str(span.span_id) if span else None,
            name=name,
            type=type,
            is_guardrail=is_guardrail,
            status=status,
            passed=passed,
            score=score,
            label=label,
            details=details,
            error=capture_exception(error) if error else None,
            timestamps=timestamps,
        )

        if current_evaluation and current_evaluation_index:
            self.evaluations[current_evaluation_index] = current_evaluation | evaluation
        else:
            self.evaluations.append(evaluation)

    def evaluate(
        self,
        slug: str,
        name: Optional[str] = None,
        input: Optional[str] = None,
        output: Optional[str] = None,
        expected_output: Optional[str] = None,
        contexts: Union[List[RAGChunk], List[str]] = [],
        conversation: Conversation = [],
        settings: Optional[dict] = None,
        as_guardrail: bool = False,
    ):
        return langwatch.evaluations.evaluate(
            trace=self,
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
            settings=settings,
            as_guardrail=as_guardrail,
        )

    async def async_evaluate(
        self,
        slug: str,
        name: Optional[str] = None,
        input: Optional[str] = None,
        output: Optional[str] = None,
        expected_output: Optional[str] = None,
        contexts: Union[List[RAGChunk], List[str]] = [],
        conversation: Conversation = [],
        settings: Optional[dict] = None,
        as_guardrail: bool = False,
    ):
        return await langwatch.evaluations.async_evaluate(
            trace=self,
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
            settings=settings,
            as_guardrail=as_guardrail,
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
                evaluations=self.evaluations,
            ),
            api_key=self.api_key,
            force_sync=self._force_sync,
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
def send_spans(
    data: CollectorRESTParams, api_key: Optional[str] = None, force_sync=False
):
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

    force_sync = f"?force_sync=true" if force_sync else ""

    if len(data["spans"]) > 256:
        warn(
            f"Going over the limit of 256 spans, dropping {len(data['spans']) - 256} spans from being sent to LangWatch"
        )
        data["spans"] = data["spans"][:256]

    # TODO: replace this with httpx, don't forget the custom SerializableWithStringFallback encoder
    response = requests.post(
        f"{langwatch.endpoint}/api/collector{force_sync}",
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
