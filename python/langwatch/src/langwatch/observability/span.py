import contextvars
from warnings import warn
from typing import List, Optional, Callable, Any, TypeVar, Dict, Union, TYPE_CHECKING
from uuid import UUID
import threading

from opentelemetry import trace as trace_api, context
from opentelemetry.trace import SpanKind, Context, _Links, Span as OtelSpan, Status, StatusCode, set_span_in_context, get_current_span
from opentelemetry.util.types import Attributes

from langwatch.domain import ChatMessage, SpanInputOutput, SpanMetrics, SpanParams, SpanTimestamps, RAGChunk
from langwatch.observability.types import SpanType, SpanInputType, ContextsType
from langwatch.__version__ import __version__
from .context import stored_langwatch_span, stored_langwatch_trace
from .utils import generate_span_id

if TYPE_CHECKING:
    from .tracing import LangWatchTrace

__all__ = ["span", "SpanType"]

T = TypeVar("T", bound=Callable[..., Any])

class LangWatchSpan:
    """A wrapper around the OpenTelemetry Span that adds LangWatch specific methods.
    
    This class extends OpenTelemetry's span functionality with LangWatch-specific features
    like input/output capture, model tracking, and context management."""

    def __init__(
        self,
        trace: Optional['LangWatchTrace'] = None,
        span_id: Optional[Union[str, UUID]] = None,
        parent: Optional[Union[OtelSpan, 'LangWatchSpan']] = None,
        capture_input: bool = True,
        capture_output: bool = True,
        name: Optional[str] = None,
        type: SpanType = "span",
        input: SpanInputType = None,
        output: SpanInputType = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: ContextsType = None,
        model: Optional[str] = None,
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
        evaluations: Optional[List[Any]] = None,  # Keep this generic for backward compatibility
        ignore_missing_trace_warning: bool = False,

        # OpenTelemetry span parameters
        kind: SpanKind = SpanKind.INTERNAL,
        span_context: Optional[Context] = None,
        attributes: Optional[Dict[str, Any]] = None,
        links: Optional[_Links] = None,
        start_time: Optional[int] = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
    ):
        # Store LangWatch-specific attributes
        self.trace = trace or stored_langwatch_trace.get(None)
        self.capture_input = capture_input
        self.capture_output = capture_output
        self.type = type
        self.ignore_missing_trace_warning = ignore_missing_trace_warning
        self._span: Optional[OtelSpan] = None
        self._context_token = None
        self._otel_token = None
        self._lock = threading.Lock()
        self._cleaned_up = False

        # Merge LangWatch attributes with OpenTelemetry attributes
        full_attributes: Attributes = attributes or {}
        if type:
            full_attributes["span.type"] = type
        if model:
            full_attributes["model"] = model
        if params:
            full_attributes.update(params)
        if metrics:
            full_attributes.update(metrics)
        if contexts:
            full_attributes["contexts"] = contexts
        if input and capture_input:
            full_attributes["input"] = input
        if output and capture_output:
            full_attributes["output"] = output
        if timestamps:
            full_attributes.update(timestamps)
        if evaluations:
            full_attributes["evaluations"] = evaluations

        if span_id is not None:
            warn("span_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `span_id` will be mapped to `deprecated.span_id` in the span's metadata.")
            full_attributes["deprecated.span_id"] = span_id

        # Get the tracer from the trace if available, otherwise fallback to default
        if self.trace:
            tracer = self.trace.tracer
        else:
            if not ignore_missing_trace_warning:
                warn("No current trace found, some spans will not be sent to LangWatch")
            tracer = trace_api.get_tracer("langwatch", __version__)

        # Handle parent span and context
        current_context = context.get_current()
        if parent is None:
            # If no explicit parent, try to get from context
            current_span = stored_langwatch_span.get(None)
            if current_span is not None:
                parent = current_span._span
            else:
                # If still no parent, use the current span from OpenTelemetry context
                parent = get_current_span()

        # Create proper context with parent... if needed
        if parent is not None:
            if isinstance(parent, LangWatchSpan):
                parent = parent._span
            if span_context is None:
                current_context = set_span_in_context(parent, current_context)

        # Create the underlying OpenTelemetry span with the proper context
        token = context.attach(current_context)
        try:
            self._span = tracer.start_span(
                name=name or type,
                context=span_context,
                kind=kind,
                attributes=full_attributes,
                links=links,
                start_time=start_time,
                record_exception=record_exception,
                set_status_on_exception=set_status_on_exception,
            )

            # Set error if provided
            if error:
                self.record_error(error)

            # Set this span in both LangWatch and OpenTelemetry contexts
            try:
                self._context_token = stored_langwatch_span.set(self)
            except Exception as e:
                warn(f"Failed to set LangWatch span context: {e}")

            try:
                self._otel_token = context.attach(set_span_in_context(self._span))
            except Exception as e:
                warn(f"Failed to set OpenTelemetry span context: {e}")
                if self._context_token is not None:
                    stored_langwatch_span.reset(self._context_token)
                    self._context_token = None
        finally:
            context.detach(token)

    def record_error(self, error: Exception) -> None:
        """Record an error in this span."""
        self._span.set_status(Status(StatusCode.ERROR))
        self._span.record_exception(error)

    def add_event(self, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Add an event to this span."""
        self._span.add_event(name, attributes)

    def update_attributes(self, attributes: Dict[str, Any]) -> None:
        """Update the span's attributes."""
        self._span.set_attributes(attributes)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Makes the span callable as a decorator."""
        if len(args) == 1 and callable(args[0]) and not kwargs:
            func: Callable[..., Any] = args[0]
            def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                with self:
                    result = func(*wargs, **wkwargs)
                    return result
            return wrapper
        return self

    def _cleanup(self) -> None:
        """Internal method to cleanup resources with proper locking."""
        with self._lock:
            if self._cleaned_up:
                return
            
            try:
                if self._context_token is not None:
                    stored_langwatch_span.reset(self._context_token)
                    self._context_token = None
            except Exception as e:
                warn(f"Failed to reset LangWatch span context: {e}")

            try:
                if self._otel_token is not None:
                    context.detach(self._otel_token)
                    self._otel_token = None
            except Exception as e:
                warn(f"Failed to detach OpenTelemetry context: {e}")

            try:
                if self._span is not None:
                    self._span.end()
                    self._span = None
            except Exception as e:
                warn(f"Failed to end span: {e}")

            self._cleaned_up = True

    def __enter__(self) -> 'LangWatchSpan':
        """Makes the span usable as a context manager."""
        if not self.ignore_missing_trace_warning and not self.trace:
            warn("No current trace found, some spans will not be sent to LangWatch")
        return self

    def __exit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        """Exit the span context, recording any errors that occurred."""
        try:
            if exc_value is not None:
                self.record_error(exc_value)
        finally:
            self._cleanup()
        return False  # Don't suppress exceptions

    def __del__(self):
        """Ensure span context is cleaned up if object is garbage collected."""
        self._cleanup()

    def __getattr__(self, name: str) -> Any:
        """Forward all other methods to the underlying span."""
        if not hasattr(self, '_span') or self._span is None:
            raise AttributeError(f"'LangWatchSpan' object has no attribute '{name}' and no underlying span")
        return getattr(self._span, name)

def span(
    name: str,
    type: SpanType,
    trace: Optional['LangWatchTrace'] = None,
    parent: Optional[Union[OtelSpan, LangWatchSpan]] = None,
    span_id: Optional[Union[str, UUID]] = None,
    capture_input: bool = True,
    capture_output: bool = True,
    input: SpanInputType = None,
    output: SpanInputType = None,
    error: Optional[Exception] = None,
    timestamps: Optional[SpanTimestamps] = None,
    contexts: ContextsType = None,
    model: Optional[str] = None,
    params: Optional[SpanParams] = None,
    metrics: Optional[SpanMetrics] = None,
    evaluations: Optional[List[Any]] = None,
    ignore_missing_trace_warning: bool = False,
    # OpenTelemetry parameters
    kind: SpanKind = SpanKind.INTERNAL,
    span_context: Optional[Context] = None,
    attributes: Optional[Dict[str, Any]] = None,
    links: Optional[_Links] = None,
    start_time: Optional[int] = None,
    record_exception: bool = True,
    set_status_on_exception: bool = True,
) -> LangWatchSpan:
    """Create a new span for tracking operations.
    
    A span represents a single operation within a trace. It can be used to track
    specific parts of your application's execution, such as LLM calls, chain executions,
    or any other meaningful operation.
    
    Args:
        name: Name of the span
        type: Type of operation this span represents
        trace: Optional trace this span belongs to
        parent: Optional parent span
        span_id: Deprecated.Optional span identifier (will be generated if not provided)
        capture_input: Whether to capture inputs
        capture_output: Whether to capture outputs
        input: Optional input data
        output: Optional output data
        error: Optional error information
        timestamps: Optional timing information
        contexts: Optional context information
        model: Optional model information
        params: Optional parameters
        metrics: Optional metrics
        evaluations: Optional evaluations
        ignore_missing_trace_warning: Whether to suppress missing trace warnings
        
        # OpenTelemetry parameters
        kind: Kind of span (default INTERNAL)
        span_context: Optional span context
        attributes: Optional span attributes
        links: Optional span links
        start_time: Optional start time
        record_exception: Whether to record exceptions
        set_status_on_exception: Whether to set status on exceptions
        end_on_exit: Whether to end span on context exit
    """
    return LangWatchSpan(
        name=name,
        type=type,
        trace=trace,
        parent=parent,
        span_id=span_id or generate_span_id(),
        capture_input=capture_input,
        capture_output=capture_output,
        input=input,
        output=output,
        error=error,
        timestamps=timestamps,
        contexts=contexts,
        model=model,
        params=params,
        metrics=metrics,
        evaluations=evaluations,
        ignore_missing_trace_warning=ignore_missing_trace_warning,
        kind=kind,
        span_context=span_context,
        attributes=attributes,
        links=links,
        start_time=start_time,
        record_exception=record_exception,
        set_status_on_exception=set_status_on_exception,
    )

class set_span_value:
    """Context manager for setting the current span."""
    span: Optional[LangWatchSpan] = None
    token: Optional[contextvars.Token] = None

    def __init__(self, span: LangWatchSpan):
        self.span = span

    def __enter__(self):
        self.token = stored_langwatch_span.set(self.span)
        return self.span

    def __exit__(self, exc_type, exc_value, traceback):
        stored_langwatch_span.reset(self.token)
