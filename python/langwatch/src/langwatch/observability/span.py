import contextvars
from copy import deepcopy
import functools
import json
from warnings import warn
from typing import List, Optional, Callable, Any, TypeVar, Dict, Union, TYPE_CHECKING
from uuid import UUID
import threading
import inspect

from langwatch.attributes import AttributeName
from langwatch.utils.transformation import autoconvert_rag_contexts, convert_typed_values
from opentelemetry import trace as trace_api, context
from opentelemetry.trace import SpanKind, Context, _Links, Span as OtelSpan, Status, StatusCode, set_span_in_context, get_current_span
from opentelemetry.util.types import Attributes

from langwatch.domain import ChatMessage, SpanInputOutput, SpanMetrics, SpanParams, SpanTimestamps, RAGChunk, SpanTypes
from langwatch.observability.types import SpanType, SpanInputType, ContextsType
from langwatch.__version__ import __version__
from .context import stored_langwatch_span, stored_langwatch_trace
from langwatch.utils.initialization import ensure_setup

if TYPE_CHECKING:
    from .tracing import LangWatchTrace

__all__ = ["span", "LangWatchSpan"]

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
        ensure_setup()

        if span_id is not None:
            warn("span_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `span_id` will be mapped to `deprecated.span_id` in the span's metadata.")
            attributes["deprecated.span_id"] = span_id

        # Store LangWatch-specific attributes
        self.name = name 
        self.trace = trace or stored_langwatch_trace.get(None)
        self.capture_input = capture_input
        self.capture_output = capture_output
        self.type = type
        self.ignore_missing_trace_warning = ignore_missing_trace_warning
        self.input = input
        self.output = output
        self.error = error
        self.timestamps = timestamps
        self.contexts = contexts
        self.model = model
        self.params = params
        self.metrics = metrics
        self.evaluations = evaluations

        # Store OpenTelemetry-specific parameters
        self.kind = kind
        self.span_context = span_context
        self.attributes = attributes
        self.links = links
        self.start_time = start_time
        self.record_exception = record_exception
        self.set_status_on_exception = set_status_on_exception
        self.parent = parent

        self._span: Optional[OtelSpan] = None
        self._context_token = None
        self._otel_token = None
        self._lock = threading.Lock()
        self._cleaned_up = False

    def _create_span(self):
        """Internal method to create and start the OpenTelemetry span."""
        # Merge LangWatch attributes with OpenTelemetry attributes
        full_attributes: Attributes = self.attributes or {}
        if self.type:
            full_attributes[AttributeName.LangWatchSpanType] = self.type
        if self.model:
            full_attributes[AttributeName.GenAIRequestModel] = self.model
        if self.params:
            full_attributes.update(self.params)
        if self.metrics:
            full_attributes.update(self.metrics)
        if self.contexts:
            full_attributes[AttributeName.LangWatchRAGContexts] = autoconvert_rag_contexts(self.contexts)
        if self.input and self.capture_input:
            full_attributes[AttributeName.LangWatchInput] = self.input
        if self.output and self.capture_output:
            full_attributes[AttributeName.LangWatchOutput] = self.output
        if self.timestamps:
            full_attributes.update(self.timestamps)

        if self.trace:
            tracer = self.trace.tracer
        else:
            if not self.ignore_missing_trace_warning:
                warn("No current trace found, some spans will not be sent to LangWatch")
            tracer = trace_api.get_tracer("langwatch", __version__)

        # Handle parent span and context
        current_context = context.get_current()
        parent = self.parent
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
            if self.span_context is None:
                current_context = set_span_in_context(parent, current_context)

        # Create the underlying OpenTelemetry span with the proper context
        token = context.attach(current_context)
        try:
            self._span = tracer.start_span(
                name=self.name or self.type,
                context=self.span_context,
                kind=self.kind,
                attributes=full_attributes,
                links=self.links,
                start_time=self.start_time,
                record_exception=self.record_exception,
                set_status_on_exception=self.set_status_on_exception,
            )

            # Set error if provided
            if self.error:
                self.record_error(self.error)

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
        ensure_setup()
        self._span.set_status(Status(StatusCode.ERROR))
        self._span.record_exception(error)

    def add_event(self, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Add an event to this span."""
        ensure_setup()
        self._span.add_event(name, attributes)

    def set_status(self, status: Status, description: Optional[str] = None) -> None:
        """Set the status of this span."""
        ensure_setup()
        self._span.set_status(status, description)

    def set_attributes(self, attributes: Dict[str, Any]) -> None:
        """Update the span's attributes."""
        ensure_setup()
        self._span.set_attributes(attributes)

    def update_name(self, name: str) -> None:
        """Update the name of the span."""
        ensure_setup()
        self.name = name
        self._span.update_name(name)

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
        **kwargs: Any,
    ) -> None:
        ensure_setup()
        attributes = dict(kwargs)

        if name is not None:
            self._span.update_name(name)
        if span_id is not None:
            warn("span_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `span_id` will be mapped to `deprecated.span_id` in the spans's metadata.")
            attributes[AttributeName.DeprecatedSpanId] = span_id
        if type is not None:
            attributes[AttributeName.LangWatchSpanType] = type
        if self.capture_input and input is not None:
            attributes[AttributeName.LangWatchInput] = deepcopy(input)
        if self.capture_output and output is not None:
            attributes[AttributeName.LangWatchOutput] = deepcopy(output)
        if error is not None:
            self.record_error(error)
        if timestamps is not None:
            if attributes[AttributeName.LangWatchTimestamps]:
                attributes[AttributeName.LangWatchTimestamps] = {**self.timestamps, **timestamps}
            else:
                attributes[AttributeName.LangWatchTimestamps] = timestamps
        if contexts is not None:
            attributes[AttributeName.LangWatchRAGContexts] = json.dumps(autoconvert_rag_contexts(contexts))
        if model is not None:
            attributes[AttributeName.GenAIRequestModel] = model
        if params is not None:
            params = deepcopy(params)
            if attributes[AttributeName.LangWatchParams]:
                attributes[AttributeName.LangWatchParams] = {**self.params, **params}
            else:
                attributes[AttributeName.LangWatchParams] = params
        if metrics is not None:
            metrics = deepcopy(metrics)
            if attributes[AttributeName.LangWatchMetrics]:
                attributes[AttributeName.LangWatchMetrics] = {**self.metrics, **metrics}
            else:
                attributes[AttributeName.LangWatchMetrics] = metrics

        self.set_attributes(attributes)

    def _get_span_params(self, func_name: Optional[str] = None) -> Dict[str, Any]:
        """Helper method to get common span parameters."""
        current_trace = stored_langwatch_trace.get(None)
        current_span = stored_langwatch_span.get(None)

        return {
            "name": self.name or func_name,
            "type": self.type,
            "trace": current_trace,  # Use the current trace
            "parent": current_span,  # Use the current span as parent
            "capture_input": self.capture_input,
            "capture_output": self.capture_output,
            "input": self.input,
            "output": self.output,
            "error": self.error,
            "timestamps": self.timestamps,
            "contexts": self.contexts,
            "model": self.model,
            "params": self.params,
            "metrics": self.metrics,
            "evaluations": self.evaluations,
            "ignore_missing_trace_warning": self.ignore_missing_trace_warning,

            # Pass through OpenTelemetry parameters
            "kind": self.kind,
            "span_context": self.span_context,
            "attributes": self.attributes,
            "links": self.links,
            "start_time": self.start_time,
            "record_exception": self.record_exception,
            "set_status_on_exception": self.set_status_on_exception,
        }

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Makes the span callable as a decorator."""

        if len(args) == 1 and callable(args[0]) and not kwargs:
            func: Callable[..., Any] = args[0]

            if inspect.isasyncgenfunction(func):
                @functools.wraps(func)
                async def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    with self:
                        self._set_callee_input_information(func, *wargs, **wkwargs)
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
                async def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    with self:
                        self._set_callee_input_information(func, *wargs, **wkwargs)
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
                async def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    async with self:
                        self._set_callee_input_information(func, *wargs, **wkwargs)
                        output = await func(*wargs, **wkwargs)
                        self._set_callee_output_information(func, output)
                        return output
                return wrapper
            else:
                @functools.wraps(func)
                def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                    with self:
                        self._set_callee_input_information(func, *wargs, **wkwargs)
                        output = func(*wargs, **wkwargs)
                        self._set_callee_output_information(func, output)
                        return output
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
        self.trace = self.trace or stored_langwatch_trace.get(None)
        if not self.ignore_missing_trace_warning and not self.trace:
            warn("No current trace found, some spans will may not be sent to LangWatch")
        self._create_span()
        return self

    def __exit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        """Exit the span context, recording any errors that occurred."""
        try:
            if exc_value is not None:
                self.record_error(exc_value)
        finally:
            self._cleanup()
        return False  # Don't suppress exceptions

    async def __aenter__(self) -> 'LangWatchSpan':
        """Makes the span usable as an async context manager."""
        self.trace = self.trace or stored_langwatch_trace.get(None)
        if not self.ignore_missing_trace_warning and not self.trace:
            warn("No current trace found, some spans may not be sent to LangWatch")
        self._create_span()
        return self

    async def __aexit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        """Exit the async span context, recording any errors that occurred."""
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

    def _set_callee_input_information(self, func: Callable[..., Any], *args: Any, **kwargs: Any):
        """Set the name and input of the span based on the callee function and arguments."""

        if self.name is None:
            self.update_name(func.__name__)
        if self.capture_input is False or self.input is not None:
            return
        
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
            if self.name is None:
                try:
                    self.update_name(f"{self_.__class__.__name__}.{func.__name__}")
                except:
                    pass
            del all_args["self"]

        if kwargs and len(kwargs) > 0:
            if kwargs:
                all_args.update(kwargs)

        if len(all_args) == 0:
            return

        self.update(input=json.dumps(convert_typed_values(all_args)))

    def _set_callee_output_information(self, func: Callable[..., Any], output: Any):
        if self.name is None:
            self.update_name(func.__name__)
        if self.capture_output is False or self.output is not None:
            return

        self.update(output=json.dumps(convert_typed_values(output)))

    @staticmethod
    def wrap_otel_span(otel_span: 'trace_api.Span', trace: Optional['LangWatchTrace'] = None) -> 'LangWatchSpan':
        """Wrap an existing OpenTelemetry span in a LangWatchSpan.
        This creates a LangWatchSpan that references the existing OpenTelemetry span
        without creating a new one.
        
        Args:
            otel_span: The OpenTelemetry span to wrap
            trace: Optional trace to associate with the span. If not provided,
                  will attempt to get the current trace from context.
            
        Returns:
            A LangWatchSpan that wraps the provided OpenTelemetry span
        """
        ensure_setup()
        from .context import stored_langwatch_trace

        if trace is None:
            trace = stored_langwatch_trace.get(None)

        # Create a LangWatchSpan that wraps the existing span
        span = LangWatchSpan.__new__(LangWatchSpan)
        span.trace = trace
        span.type = "span"
        span.ignore_missing_trace_warning = True
        span._span = otel_span
        span._context_token = None
        span._otel_token = None
        span._lock = threading.Lock()
        span._cleaned_up = False
        # TODO(afr): Check if this is correct
        span.capture_input = True
        span.capture_output = True
        return span

def span(
    trace: Optional['LangWatchTrace'] = None,
    parent: Optional[Union[OtelSpan, LangWatchSpan]] = None,
    span_id: Optional[Union[str, UUID]] = None,
    name: Optional[str] = None,
    type: Optional[SpanType] = None,
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
    """
    ensure_setup()

    return LangWatchSpan(
        name=name,
        type=type,
        trace=trace,
        parent=parent,
        span_id=span_id,
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
