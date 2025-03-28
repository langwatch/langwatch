import contextvars
from logging import warn
from types import ModuleType
from uuid import UUID
import httpx
import threading
from deprecated import deprecated
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider, Tracer
from typing import List, Optional, Callable, Any, TypeVar, Dict, Union

from langwatch.state import get_endpoint
from langwatch.domain import ChatMessage, Evaluation, RAGChunk, SpanInputOutput, SpanMetrics, SpanParams, SpanTimestamps, SpanTypes, TraceMetadata
from langwatch.observability.span import LangWatchSpan
from langwatch.observability.types import SpanType
from langwatch.__version__ import __version__
from .context import stored_langwatch_trace
from .utils import generate_trace_id, generate_span_id

__all__ = ["trace"]

T = TypeVar("T", bound=Callable[..., Any])

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
        self.api_key = api_key
        self.max_string_length = max_string_length
        self._context_token = None
        self._lock = threading.Lock()
        self._expected_output = expected_output
        self._cleaned_up = False

        if trace_id is not None:
            warn("trace_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `trace_id` will be mapped to `deprecated.trace_id` in the trace's metadata.")
            metadata["deprecated.trace_id"] = trace_id

        # If sending is disabled, use a NoOpTracerProvider
        tracer_provider = trace_api.NoOpTracerProvider() if disable_sending else tracer_provider

        self.tracer = trace_api.get_tracer(
            instrumenting_module_name="langwatch",
            instrumenting_library_version=__version__,
            tracer_provider=tracer_provider,
            attributes=metadata,
        )

        if not skip_root_span:
            self.root_span = LangWatchSpan(
                trace=self,
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
            )

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
        client: Union["OpenAI", "AsyncOpenAI", "AzureOpenAI", "AsyncAzureOpenAI"]
    ):
        from openinference.instrumentation.openai import OpenAIInstrumentor
        OpenAIInstrumentor().instrument()

    @deprecated(
        reason="This method of instrumenting LiteLLM is deprecated and will be removed in a future version. Please refer to the docs to see the new way to instrument LiteLLM."
    )
    def autotrack_litellm_calls(self, client: ModuleType):
        from openinference.instrumentation.litellm import LiteLLMInstrumentor
        LiteLLMInstrumentor().instrument()

    def share(self) -> str:
        """Share this trace and get a shareable URL."""
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
            with set_langwatch_trace_value(self):
                func: Callable[..., Any] = args[0]
                def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    result = func(*wargs, **wkwargs)
                    return result
                return wrapper
        return self

    def __enter__(self) -> 'LangWatchTrace':
        """Makes the trace usable as a context manager."""
        self._context_token = stored_langwatch_trace.set(self)
        if hasattr(self, 'root_span'):
            self.root_span.__enter__()
        return self

    def __exit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        """Exit the trace context, cleaning up resources."""
        try:
            if hasattr(self, 'root_span'):
                self.root_span.__exit__(exc_type, exc_value, traceback)
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
    tracer_provider: Optional[TracerProvider] = None,
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
) -> LangWatchTrace:
    """Create a new trace for tracking operations.
    
    A trace represents a complete request/response cycle in your application.
    It can contain multiple spans representing different operations within that cycle.
    
    Args:
        trace_id: Deprecated. Optional identifier for the trace
        metadata: Optional metadata to attach to the trace
        expected_output: Optional expected output for evaluation
        api_key: Optional API key for LangWatch
        disable_sending: Whether to disable sending traces
        max_string_length: Maximum length for string values (default 5000)
        tracer_provider: Optional custom tracer provider
        
        # Root span parameters
        span_id: Deprecated. Optional identifier for the root span
        capture_input: Whether to capture inputs
        capture_output: Whether to capture outputs
        name: Optional name for the root span
        type: Type of the root span
        input: Optional input data
        output: Optional output data
        error: Optional error information
        timestamps: Optional timing information
        contexts: Optional context information
        model: Optional model information
        params: Optional parameters
        metrics: Optional metrics
        evaluations: Optional evaluations
        skip_root_span: Whether to skip creating a root span
    """
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

