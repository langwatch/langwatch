import contextvars
from logging import warn
from types import ModuleType
from uuid import UUID
import httpx
import threading
from deprecated import deprecated
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from typing import List, Optional, Callable, Any, TypeVar, Union, Dict
from warnings import warn
import sys
import asyncio
import inspect

from langwatch.state import get_endpoint, get_instance
from langwatch.domain import ChatMessage, Evaluation, RAGChunk, SpanInputOutput, SpanMetrics, SpanParams, SpanTimestamps, SpanTypes, TraceMetadata
from langwatch.observability.span import LangWatchSpan
from langwatch.observability.types import SpanType, SpanInputType, ContextsType
from langwatch.__version__ import __version__
from langwatch.observability.context import stored_langwatch_trace, stored_langwatch_span
from langwatch.utils.initialization import ensure_setup

__all__ = ["trace", "get_current_trace", "get_current_span", "sampling_rate"]

T = TypeVar("T", bound=Callable[..., Any])

class SamplingRateDescriptor:
    """Property descriptor for getting the sampling rate from the root tracer provider."""
    
    def __get__(self, obj, objtype=None) -> float:
        """Get the sampling rate from the root OpenTelemetry tracer provider.

        Returns:
            The sampling rate as a float between 0 and 1. Returns 1.0 if:
            - No tracer provider is set
            - The tracer provider doesn't have a sampler
            - The tracer provider is a NoOpTracerProvider
            - The sampling rate cannot be determined
        """
        tracer_provider = trace_api.get_tracer_provider()
        if not tracer_provider or isinstance(tracer_provider, trace_api.NoOpTracerProvider):
            return 1.0
            
        try:
            # Access the sampler from the tracer provider
            sampler = tracer_provider.sampler
            if hasattr(sampler, 'rate'):
                return float(sampler.rate)
            elif hasattr(sampler, 'sampling_rate'):
                return float(sampler.sampling_rate)
            return 1.0
        except Exception:
            return 1.0

sampling_rate = SamplingRateDescriptor()

def get_current_trace() -> Optional['LangWatchTrace']:
    """Get the current trace from the LangWatch context.
    
    Returns:
        The current LangWatchTrace if one exists in the context, otherwise None.
    """
    ensure_setup()
    return stored_langwatch_trace.get(None)

def get_current_span() -> Optional[LangWatchSpan]:
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

        if trace_id is not None:
            warn("trace_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `trace_id` will be mapped to `deprecated.trace_id` in the trace's metadata.")
            metadata["deprecated.trace_id"] = trace_id

        # Determine which tracer provider to use
        if disable_sending:
            tracer_provider = trace_api.NoOpTracerProvider()
        elif tracer_provider is not None:
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

    def _create_root_span(self):
        """Create the root span if parameters were provided."""
        if self._root_span_params is not None:
            self.root_span = LangWatchSpan(
                trace=self,
                **self._root_span_params
            )
            return self.root_span.__enter__()

    async def _create_root_span_async(self):
        """Create the root span asynchronously if parameters were provided."""
        if self._root_span_params is not None:
            self.root_span = LangWatchSpan(
                trace=self,
                **self._root_span_params
            )
            return await self.root_span.__aenter__()

    def _cleanup(self) -> None:
        """Internal method to cleanup resources with proper locking."""
        with self._lock:
            if self._cleaned_up:
                return
            
            try:
                if hasattr(self, 'root_span'):
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
        OpenAIInstrumentor().instrument(tracer_provider=trace_api.get_tracer_provider())

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
                headers={"Authorization": f"Bearer {self.api_key}"},
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
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=15,
            )
            response.raise_for_status()

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Makes the trace callable as a decorator."""

        if len(args) == 1 and callable(args[0]) and not kwargs:
            func: Callable[..., Any] = args[0]
            if inspect.iscoroutinefunction(func):
                async def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    async with self:  # Use async context manager for async functions
                        result = await func(*wargs, **wkwargs)
                        return result
                return wrapper
            else:
                def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    with self:  # Use regular context manager for sync functions
                        result = func(*wargs, **wkwargs)
                        return result
                return wrapper
        return self

    def __enter__(self) -> 'LangWatchTrace':
        """Makes the trace usable as a context manager."""
        self._context_token = stored_langwatch_trace.set(self)
        self._create_root_span()
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
        return self

    async def __aexit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        """Exit the async trace context, cleaning up resources."""
        try:
            if hasattr(self, 'root_span'):
                await self.root_span.__aexit__(exc_type, exc_value, traceback)
        finally:
            self._cleanup()
        return False

    def __del__(self):
        """Ensure trace context is cleaned up if object is garbage collected."""
        self._cleanup()

    # Forward all other methods to the underlying tracer
    def __getattr__(self, name: str) -> Any:
        return getattr(self.tracer, name)

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

class set_langwatch_trace_value:
    """Context manager for setting the current trace."""
    trace: Optional[LangWatchTrace] = None
    token: Optional[contextvars.Token] = None

    def __init__(self, trace: LangWatchTrace):
        self.trace = trace

    def __enter__(self):
        self.token = stored_langwatch_trace.set(self.trace)
        return self.trace

    def __exit__(self, exc_type, exc_value, traceback):
        stored_langwatch_trace.reset(self.token)

