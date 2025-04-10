import contextvars
import functools
import json
from logging import warn
from types import ModuleType
from uuid import UUID
import httpx
import threading
from deprecated import deprecated
from langwatch.attributes import AttributeName
from langwatch.utils.transformation import SerializableWithStringFallback, convert_typed_values
import nanoid
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from typing import Dict, List, Literal, Optional, Callable, Any, Type, TypeVar, Union, cast
from warnings import warn
import inspect

from langwatch.state import get_api_key, get_endpoint, get_instance
from langwatch.domain import ChatMessage, Conversation, Evaluation, EvaluationTimestamps, Money, MoneyDict, RAGChunk, SpanInputOutput, SpanMetrics, SpanParams, SpanTimestamps, SpanTypes, TraceMetadata
from langwatch.observability.span import LangWatchSpan
from langwatch.__version__ import __version__
from langwatch.observability.context import stored_langwatch_trace, stored_langwatch_span
from langwatch.utils.initialization import ensure_setup

__all__ = ["trace", "get_current_trace", "get_current_span"]

T = TypeVar("T", bound=Callable[..., Any])

def get_current_trace() -> Optional['LangWatchTrace']:
    """Get the current trace from the LangWatch context.
    
    Returns:
        The current LangWatchTrace if one exists in the context, otherwise None.
    """
    ensure_setup()
    return stored_langwatch_trace.get(None)

def get_current_span() -> Optional['LangWatchSpan']:
    """Get the current span from the LangWatch context.
    If no span exists in LangWatch context, falls back to OpenTelemetry context.
    
    Returns:
        The current LangWatchSpan if one exists in either context, otherwise None.
    """
    ensure_setup()

    # First try getting from LangWatch context
    span = stored_langwatch_span.get(None)
    if span is not None:
        return span
        
    # Fall back to OpenTelemetry context
    otel_span = trace_api.get_current_span()
    if otel_span is not None and not isinstance(otel_span, trace_api.NonRecordingSpan):
        # Get current trace to associate with the span
        trace = get_current_trace()
        return LangWatchSpan.wrap_otel_span(otel_span, trace)
    
    return None

class LangWatchTrace:
    """A trace represents a complete request/response cycle in your application.
    It can contain multiple spans representing different operations within that cycle."""

    _root_span_params: Optional[Dict[str, Any]] = None
    root_span: Optional[LangWatchSpan] = None
    span: Optional[LangWatchSpan] = None
    evaluations: List[Evaluation] = []

    def __init__(
        self,
        trace_id: Optional[Union[str, UUID]] = None,
        metadata: Optional[TraceMetadata] = None,
        expected_output: Optional[str] = None,
        api_key: Optional[str] = None,
        disable_sending: bool = False,
        max_string_length: Optional[int] = 5000,

        # Root span parameters
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

        tracer_provider: Optional[TracerProvider] = None,
    ):
        ensure_setup()

        self.api_key = api_key
        self.max_string_length = max_string_length
        self._context_token = None
        self._lock = threading.Lock()
        self._expected_output = expected_output
        self._cleaned_up = False
        self.span = cast(
            Type[LangWatchSpan], lambda **kwargs: LangWatchSpan(trace=self, **kwargs)
        )

        if metadata is None:
            metadata = {}
        if trace_id is not None:
            warn("trace_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `trace_id` will be mapped to `deprecated.trace_id` in the trace's metadata.")
            metadata["deprecated.trace_id"] = trace_id

        if disable_sending:
            client = get_instance()
            if client:
                client.disable_sending = True

        # Determine which tracer provider to use
        if tracer_provider is not None:
            # Use the explicitly provided tracer provider
            pass
        else:
            # Get the client instance which will have the properly initialized tracer provider
            client = get_instance()
            if client is not None and client.tracer_provider is not None:
                tracer_provider = client.tracer_provider
            else:
                # Fall back to global tracer provider
                tracer_provider = trace_api.get_tracer_provider()

        self.tracer = trace_api.get_tracer(
            instrumenting_module_name="langwatch",
            instrumenting_library_version=__version__,
            tracer_provider=tracer_provider,
            attributes=metadata,
        )

        # Store root span parameters for later creation
        self._root_span_params = {
            "span_id": span_id,
            "capture_input": capture_input,
            "capture_output": capture_output,
            "name": name,
            "type": type,
            "input": input,
            "output": output,
            "error": error,
            "timestamps": timestamps,
            "contexts": contexts,
            "model": model,
            "params": params,
            "metrics": metrics,
            "evaluations": evaluations,
        } if not skip_root_span else None

        if skip_root_span is False:
            self._create_root_span()

    def _create_root_span(self):
        """Create the root span if parameters were provided."""

        if self._root_span_params is not None:
            self.root_span = LangWatchSpan(
                trace=self,
                **self._root_span_params
            )
            
            self.root_span.__enter__()
            return self.root_span

    async def _create_root_span_async(self):
        """Create the root span asynchronously if parameters were provided."""

        if self._root_span_params is not None:
            self.root_span = LangWatchSpan(
                trace=self,
                **self._root_span_params
            )
            # Ensure the span is properly initialized before returning
            await self.root_span.__aenter__()
            return self.root_span

    def _cleanup(self) -> None:
        """Internal method to cleanup resources with proper locking."""
        with self._lock:
            if self._cleaned_up:
                return

            try:
                if self.root_span is not None:
                    self.root_span._cleanup()
            except Exception as e:
                warn(f"Failed to cleanup root span: {e}")

            try:
                if self._context_token is not None:
                    stored_langwatch_trace.reset(self._context_token)
                    self._context_token = None
            except Exception as e:
                warn(f"Failed to reset LangWatch trace context: {e}")

            self._cleaned_up = True

    @deprecated(
        reason="This method of instrumenting OpenAI is deprecated and will be removed in a future version. Please refer to the docs to see the new way to instrument OpenAI."
    )
    def autotrack_openai_calls(
        self,
        client: Any,
    ):
        from openinference.instrumentation.openai import OpenAIInstrumentor
        OpenAIInstrumentor().instrument()

    @deprecated(
        reason="This method of instrumenting LiteLLM is deprecated and will be removed in a future version. Please refer to the docs to see the new way to instrument LiteLLM."
    )
    def autotrack_litellm_calls(self, client: ModuleType):
        from openinference.instrumentation.litellm import LiteLLMInstrumentor
        LiteLLMInstrumentor().instrument()

    def autotrack_dspy(
        self,
        experiment: str,
        optimizer: Optional["Teleprompter"] = None,
        run_id: Optional[str] = None,
        slug: Optional[str] = None,
        workflow_id: Optional[str] = None,
        workflow_version_id: Optional[str] = None,
    ):
        """Automatically track DSPy experiments with LangWatch.
        
        Args:
            experiment: Name of the experiment
            optimizer: Optional DSPy optimizer (Teleprompter) to track
            run_id: Optional run identifier
            slug: Optional experiment slug
            workflow_id: Optional workflow identifier
            workflow_version_id: Optional workflow version identifier
        """
        ensure_setup()

        from langwatch.instrumentation.dspy import langwatch_dspy
        
        with self:
            langwatch_dspy.init(
                experiment=experiment,
                optimizer=optimizer,
                run_id=run_id,
                slug=slug,
                workflow_id=workflow_id,
                workflow_version_id=workflow_version_id
            )

    def share(self) -> str:
        """Share this trace and get a shareable URL."""
        ensure_setup()
        endpoint = get_endpoint()
        with httpx.Client() as client:
            response = client.post(
                f"{endpoint}/api/trace/{self.trace_id}/share",
                headers={"X-Auth-Token": get_api_key()},
                timeout=15,
            )
            response.raise_for_status()
            path = response.json()["path"]
            return f"{endpoint}{path}"
        
    def unshare(self):
        """Make this trace private again."""
        ensure_setup()
        endpoint = get_endpoint()
        with httpx.Client() as client:
            response = client.post(
                f"{endpoint}/api/trace/{self.trace_id}/unshare",
                headers={"X-Auth-Token": get_api_key()},
                timeout=15,
            )
            response.raise_for_status()

    def update(
        self,
        trace_id: Optional[Union[str, UUID]] = None,
        metadata: Optional[TraceMetadata] = None,
        expected_output: Optional[str] = None,
        disable_sending: Optional[bool] = None,

        # root span update
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
        ensure_setup()

        if metadata is None:
            metadata = {}
        if trace_id is not None:
            metadata[AttributeName.DeprecatedTraceId] = trace_id
        if expected_output is not None:
            self._expected_output = expected_output
        if disable_sending is not None:
            get_instance().disable_sending = disable_sending

        self.root_span.set_attributes({
            "metadata": json.dumps(metadata, cls=SerializableWithStringFallback),
        })

        self.root_span.update(
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
        span: Optional[LangWatchSpan] = None,
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
        from langwatch import evaluations
        return evaluations.add_evaluation(
            trace=self,
            span=span,
            evaluation_id=evaluation_id,
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
        from langwatch import evaluations
        return evaluations.evaluate(
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
        from langwatch import evaluations
        return await evaluations.async_evaluate(
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

    def __call__(self, func: T) -> T:
        """Makes the trace callable as a decorator."""

        if inspect.isasyncgenfunction(func):
            @functools.wraps(func)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    items = []
                    async for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    self._set_callee_output_information(func, output)
            return wrapper
        elif inspect.isgeneratorfunction(func):
            @functools.wraps(func)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    items = []
                    for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    self._set_callee_output_information(func, output)
            return wrapper
        elif inspect.iscoroutinefunction(func):
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                async with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    output = await func(*args, **kwargs)
                    self._set_callee_output_information(func, output)
                    return output
            return wrapper
        else:
            @functools.wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    output = func(*args, **kwargs)
                    self._set_callee_output_information(func, output)
                    return output
            return wrapper

    def __enter__(self) -> 'LangWatchTrace':
        """Makes the trace usable as a context manager."""
        self._context_token = stored_langwatch_trace.set(self)
        self._create_root_span().__enter__()

        self.span = cast(
            Type[LangWatchSpan], lambda **kwargs: LangWatchSpan(trace=self, **kwargs)
        )

        return self

    def __exit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        """Exit the trace context, cleaning up resources."""
        try:
            if hasattr(self, 'root_span'):
                self.root_span.__exit__(exc_type, exc_value, traceback)
        finally:
            self._cleanup()
        return False

    async def __aenter__(self) -> 'LangWatchTrace':
        """Makes the trace usable as an async context manager."""
        self._context_token = stored_langwatch_trace.set(self)
        await self._create_root_span_async()

        self.span = cast(
            Type[LangWatchSpan], lambda **kwargs: LangWatchSpan(trace=self, **kwargs)
        )

        return self

    async def __aexit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        """Exit the async trace context, cleaning up resources."""
        try:
            if hasattr(self, 'root_span'):
                await self.root_span.__aexit__(exc_type, exc_value, traceback)
        finally:
            self._cleanup()
        return False

    # def __del__(self):
    #     """Ensure trace context is cleaned up if object is garbage collected."""
    #     self._cleanup()

    # Forward all other methods to the underlying tracer
    def __getattr__(self, name: str) -> Any:
        return getattr(self.tracer, name)

    def _set_callee_input_information(self, func: Callable[..., Any], *args: Any, **kwargs: Any):
        """Set the name and input of the trace based on the callee function and arguments."""

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
            if self.root_span.name is None:
                try:
                    self.root_span.update_name(f"{self_.__class__.__name__}.{func.__name__}")
                except:
                    pass
            del all_args["self"]

        # Fallback to only the function name if no name is set
        if self.root_span.name is None:
            self.root_span.update_name(func.__name__)

        if self.root_span.capture_input is False or self.root_span.input is not None:
            return

        if kwargs and len(kwargs) > 0:
            if kwargs:
                all_args.update(kwargs)

        if len(all_args) == 0:
            return

        self.root_span.update(input=convert_typed_values(all_args))

    def _set_callee_output_information(self, func: Callable[..., Any], output: Any):
        """Set the output of the trace based on the callee function and output."""

        if self._root_span_params is not None:
            if self.root_span.name is None:
                self.root_span.update_name(func.__name__)
            if self.root_span.capture_input is False or self.root_span.output is not None:
                return

            self.root_span.update(output=convert_typed_values(output))

    @property
    def disable_sending(self) -> bool:
        """Get whether sending is disabled."""
        ensure_setup()
        client = get_instance()
        return client.disable_sending

    @disable_sending.setter
    @deprecated(
        reason="Setting disable_sending on the trace is deprecated. Please set it on the LangWatch client instance instead using `langwatch.get_instance().disable_sending = True`"
    )
    def disable_sending(self, value: bool) -> None:
        """Set whether sending is disabled. This will also update the client's setting."""
        ensure_setup()
        client = get_instance()
        if client is not None:
            client.disable_sending = value


def trace(
    trace_id: Optional[Union[str, UUID]] = None,
    metadata: Optional[TraceMetadata] = None,
    expected_output: Optional[str] = None,
    api_key: Optional[str] = None,
    disable_sending: bool = False,
    max_string_length: Optional[int] = 5000,

    # Root span parameters
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

    tracer_provider: Optional[TracerProvider] = None,
) -> LangWatchTrace:
    """Create a new trace for tracking a complete request/response cycle.
    
    A trace represents a complete request/response cycle in your application.
    It can contain multiple spans representing different operations within that cycle.
    """
    # Ensure client is setup
    ensure_setup()

    return LangWatchTrace(
        trace_id=trace_id,
        metadata=metadata,
        expected_output=expected_output,
        api_key=api_key,
        disable_sending=disable_sending,
        max_string_length=max_string_length,
        tracer_provider=tracer_provider,
        span_id=span_id,
        capture_input=capture_input,
        capture_output=capture_output,
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
        evaluations=evaluations,
        skip_root_span=skip_root_span,
    )
