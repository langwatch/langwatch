from copy import deepcopy
import functools
import json
from warnings import warn
from typing import (
    List,
    Literal,
    Optional,
    Callable,
    Any,
    Type,
    TypeVar,
    Dict,
    Union,
    TYPE_CHECKING,
    cast,
)
from uuid import UUID
import threading
import inspect

from langwatch.attributes import AttributeName
from langwatch.utils.transformation import (
    SerializableWithStringFallback,
    rag_contexts,
    convert_typed_values,
    truncate_object_recursively,
)
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import (
    SpanKind,
    Link,
    Span as OtelSpan,
    Status,
    StatusCode,
    get_current_span,
    SpanContext,
    set_span_in_context,
)
from opentelemetry.context import Context

from langwatch.domain import (
    ChatMessage,
    Conversation,
    EvaluationTimestamps,
    Money,
    MoneyDict,
    SpanInputOutput,
    SpanMetrics,
    SpanParams,
    SpanTimestamps,
    RAGChunk,
    SpanTypes,
)
from langwatch.telemetry.types import SpanType, SpanInputType, ContextsType
from langwatch.__version__ import __version__
from .context import stored_langwatch_span, stored_langwatch_trace, get_current_trace
from langwatch.utils.initialization import ensure_setup

if TYPE_CHECKING:
    from .tracing import LangWatchTrace

__all__ = ["span", "LangWatchSpan"]

T = TypeVar("T", bound=Callable[..., Any])


class LangWatchSpan:
    """A wrapper around the OpenTelemetry Span that adds LangWatch specific methods.

    This class extends OpenTelemetry's span functionality with LangWatch-specific features
    like input/output capture, model tracking, and context management."""

    span: Type["LangWatchSpan"]

    def __init__(
        self,
        trace: Optional["LangWatchTrace"] = None,
        span_id: Optional[Union[str, UUID]] = None,
        parent: Optional[Union[OtelSpan, "LangWatchSpan"]] = None,
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
        evaluations: Optional[
            List[Any]
        ] = None,  # Keep this generic for backward compatibility
        ignore_missing_trace_warning: bool = False,
        # OpenTelemetry parameters
        kind: SpanKind = SpanKind.INTERNAL,
        span_context: Optional[context_api.Context] = None,
        attributes: Optional[Dict[str, Any]] = None,
        links: Optional[List[Link]] = None,
        start_time: Optional[int] = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
    ):
        ensure_setup()

        attributes = attributes or {}

        if span_id is not None:
            warn(
                "span_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `span_id` will be mapped to `deprecated.span_id` in the spans's metadata."
            )
            attributes[AttributeName.DeprecatedSpanId] = str(span_id)

        # Initialize critical instance attributes first
        self._lock = threading.Lock()
        self._span = None
        self._cleaned_up = False

        # Initialize other attributes
        self.trace = trace
        self.type: SpanTypes = type
        self.ignore_missing_trace_warning = ignore_missing_trace_warning
        self.capture_input = capture_input
        self.capture_output = capture_output
        self.name = name
        self.parent = parent
        self.input = input
        self.output = output
        self.error = error
        self.timestamps = timestamps or {}
        self.contexts = contexts
        self.model = model
        self.params = params
        self.metrics = metrics
        self.evaluations = evaluations

        # Store OpenTelemetry-specific parameters
        self._span = None
        self._span_context_manager = None
        self.kind = kind
        self.span_context = span_context
        self.attributes = attributes or {}
        self.links = links
        self.start_time = start_time
        self.record_exception = record_exception
        self.set_status_on_exception = set_status_on_exception

        self.span = cast(
            Type["LangWatchSpan"],
            lambda **kwargs: LangWatchSpan(
                trace=trace or stored_langwatch_trace.get(None), **kwargs
            ),
        )

        if self.trace:
            self._create_span()

    def _create_span(self):
        """Internal method to create and start the OpenTelemetry span."""
        try:
            if self.trace:
                tracer = self.trace.tracer
            else:
                if not self.ignore_missing_trace_warning:
                    warn(
                        "No current trace found, some spans may not be sent to LangWatch"
                    )
                tracer = trace_api.get_tracer("langwatch", __version__)

            # Handle parent span
            parent = self.parent
            if parent is None:
                # If no explicit parent, try to get from context
                current_span = stored_langwatch_span.get(None)
                if current_span is not None and current_span._span is not None:
                    parent = current_span._span
                else:
                    # If still no parent, use the current span from OpenTelemetry context
                    parent = get_current_span()
            parent_span_context: Optional[Context] = None
            if isinstance(parent, LangWatchSpan) and parent._span is not None:
                parent_span_context = set_span_in_context(parent._span)

            # Create the underlying OpenTelemetry span
            try:
                self._span_context_manager = tracer.start_as_current_span(
                    name=self.name or self.type,
                    context=self.span_context or parent_span_context,
                    kind=self.kind,
                    links=self.links,
                    start_time=self.start_time,
                    record_exception=self.record_exception,
                    set_status_on_exception=self.set_status_on_exception,
                    attributes=self.attributes,
                    end_on_exit=True,
                )
                self._span = self._span_context_manager.__enter__()

                if not self._span:
                    warn("Failed to create span - got None from tracer")
                    return

            except Exception as e:
                warn(
                    f"Failed to create span: {str(e)}. Span operations will be no-ops."
                )
                return

            try:
                self.update(
                    name=self.name,
                    type=self.type,
                    input=self.input,
                    output=self.output,
                    error=self.error,
                    timestamps=self.timestamps,
                    contexts=self.contexts,
                    model=self.model,
                    params=self.params,
                    metrics=self.metrics,
                    **(self.attributes or {}),
                )
            except Exception as e:
                warn(f"Failed to update span attributes: {str(e)}")

        except Exception as e:
            warn(
                f"Unexpected error creating span: {str(e)}. Span operations will be no-ops."
            )

    def record_error(self, error: Exception) -> None:
        """Record an error in this span."""
        if self._span is None:
            warn("Cannot record error - no span available")
            return
        try:
            self._span.set_status(Status(StatusCode.ERROR))
            self._span.record_exception(error)
        except Exception as e:
            warn(f"Failed to record error on span: {str(e)}")

    def add_event(self, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        """Add an event to this span."""
        if self._span is None:
            warn("Cannot add event - no span available")
            return
        try:
            self._span.add_event(name, attributes)
        except Exception as e:
            warn(f"Failed to add event to span: {str(e)}")

    def set_status(self, status: Status, description: Optional[str] = None) -> None:
        """Set the status of this span."""
        if self._span is None:
            warn("Cannot set status - no span available")
            return
        try:
            self._span.set_status(status, description)
        except Exception as e:
            warn(f"Failed to set status on span: {str(e)}")

    def set_attributes(self, attributes: Dict[str, Any]) -> None:
        """Set attributes on this span."""
        if self._span is None:
            warn("Cannot set attributes - no span available")
            return
        try:
            self._span.set_attributes(attributes)
        except Exception as e:
            warn(f"Failed to set attributes on span: {str(e)}")

    def update_name(self, name: str) -> None:
        """Update the name of the span."""
        if self._span is None:
            warn("Cannot update name - no span available")
            return
        try:
            self.name = name
            self._span.update_name(name)
        except Exception as e:
            warn(f"Failed to update name on span: {str(e)}")

    def get_span_context(self) -> Optional[SpanContext]:
        """Get the span context of this span."""
        if self._span is None:
            warn("Cannot get span context - no span available")
            return None
        return self._span.get_span_context()

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

        if self._span is None:
            warn("Cannot set attributes - no span available")
            return

        attributes = dict(kwargs)

        if name is not None:
            self.name = name
            self.update_name(name)
        if span_id is not None:
            warn(
                "span_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `span_id` will be mapped to `deprecated.span_id` in the spans's metadata."
            )
            attributes[AttributeName.DeprecatedSpanId] = str(span_id)
        if type is not None:
            self.type = type
            attributes[AttributeName.LangWatchSpanType] = str(type)
        if self.capture_input and input is not None:
            self.input = input
            attributes[AttributeName.LangWatchInput] = json.dumps(
                truncate_object_recursively(
                    convert_typed_values(deepcopy(input)),
                    max_string_length=(
                        self.trace or get_current_trace()
                    ).max_string_length,
                ),
                cls=SerializableWithStringFallback,
            )
        if self.capture_output and output is not None:
            self.output = output
            attributes[AttributeName.LangWatchOutput] = json.dumps(
                truncate_object_recursively(
                    convert_typed_values(deepcopy(output)),
                    max_string_length=(
                        self.trace or get_current_trace()
                    ).max_string_length,
                ),
                cls=SerializableWithStringFallback,
            )
        if error is not None:
            self.error = error
            self.record_error(error)
        if timestamps is not None:
            self.timestamps = timestamps
            attributes[AttributeName.LangWatchTimestamps] = json.dumps(
                timestamps, cls=SerializableWithStringFallback
            )
        if contexts is not None:
            self.contexts = contexts
            attributes[AttributeName.LangWatchRAGContexts] = json.dumps(
                truncate_object_recursively(
                    rag_contexts(contexts),
                    max_string_length=(
                        self.trace or get_current_trace()
                    ).max_string_length,
                ),
                cls=SerializableWithStringFallback,
            )
        if model is not None:
            self.model = model
            attributes[AttributeName.GenAIRequestModel] = model
        if params is not None:
            params = deepcopy(params)
            self.params = {**(self.params or {}), **params}
            attributes[AttributeName.LangWatchParams] = json.dumps(
                self.params, cls=SerializableWithStringFallback
            )
        if metrics is not None:
            metrics = deepcopy(metrics)
            self.metrics = {**(self.metrics or {}), **metrics}
            attributes[AttributeName.LangWatchMetrics] = json.dumps(
                self.metrics, cls=SerializableWithStringFallback
            )

        self.set_attributes(attributes)

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

        from langwatch import evaluations

        return evaluations.add_evaluation(
            span=self,
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
        settings: Optional[Dict[str, Any]] = None,
        as_guardrail: bool = False,
    ):
        contexts = contexts or []
        conversation = conversation or []

        from langwatch import evaluations

        return evaluations.evaluate(
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
        settings: Optional[Dict[str, Any]] = None,
        as_guardrail: bool = False,
    ):
        contexts = contexts or []
        conversation = conversation or []

        from langwatch import evaluations

        return await evaluations.async_evaluate(
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
        end_time: Optional[int] = None,
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
        self.update(
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
            **kwargs,
        )
        if hasattr(self, "_span_context_manager") and self._span_context_manager is not None:
            self._span_context_manager.__exit__(None, error, None)
        elif hasattr(self, "_span") and self._span is not None:
            self._span.end(end_time)

    def _get_span_params(self, func_name: Optional[str] = None) -> Dict[str, Any]:
        """Helper method to get common span parameters."""
        current_trace = stored_langwatch_trace.get(None)
        current_span = get_current_span()

        return {
            "name": self.name or func_name,
            "type": self.type,
            "trace": current_trace,
            "parent": current_span,
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

    def __call__(self, func: T) -> T:
        """Makes the span callable as a decorator."""

        if inspect.isasyncgenfunction(func):

            @functools.wraps(func)
            async def async_gen_wrapper(*args: Any, **kwargs: Any) -> Any:
                async with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    items: List[Any] = []
                    async for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    self._set_callee_output_information(func, output)

            return cast(T, async_gen_wrapper)
        elif inspect.isgeneratorfunction(func):

            @functools.wraps(func)
            def sync_gen_wrapper(*args: Any, **kwargs: Any):
                with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    items: List[Any] = []
                    for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    self._set_callee_output_information(func, output)

            return cast(T, sync_gen_wrapper)
        elif inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                async with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    output = await func(*args, **kwargs)
                    self._set_callee_output_information(func, output)
                    return output

            return cast(T, async_wrapper)
        else:

            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                with self:
                    self._set_callee_input_information(func, *args, **kwargs)
                    output = func(*args, **kwargs)
                    self._set_callee_output_information(func, output)
                    return output

            return cast(T, sync_wrapper)

    def _cleanup(
        self,
        exc_type: Optional[type],
        exc_value: Optional[BaseException],
        traceback: Any,
    ) -> None:
        """Internal method to cleanup resources with proper locking."""
        with self._lock:
            if self._cleaned_up:
                return

            if hasattr(self, "_span_context_manager") and self._span_context_manager is not None:  # type: ignore
                try:
                    self._span_context_manager.__exit__(exc_type, exc_value, traceback)
                except Exception as e:
                    warn(f"Failed to end span: {e}")
                finally:
                    self._span_context_manager = None
            
            if hasattr(self, "_span") and self._span is not None:
                self._span = None

            self._cleaned_up = True

    def __enter__(self) -> "LangWatchSpan":
        """Makes the span usable as a context manager."""
        self.trace = self.trace or stored_langwatch_trace.get(None)
        if not self.ignore_missing_trace_warning and not self.trace:
            warn("No current trace found, some spans will may not be sent to LangWatch")

        self._create_span()
        self.span = cast(
            Type["LangWatchSpan"],
            lambda **kwargs: LangWatchSpan(
                trace=self.trace or stored_langwatch_trace.get(None), **kwargs
            ),
        )

        return self

    def __exit__(
        self,
        exc_type: Optional[type],
        exc_value: Optional[BaseException],
        traceback: Any,
    ) -> bool:
        """Exit the span context, recording any errors that occurred."""
        try:
            # Fix: Check if exc_value is an Exception before recording
            if exc_value is not None and isinstance(exc_value, Exception):
                self.record_error(exc_value)
        finally:
            self._cleanup(exc_type, exc_value, traceback)
        return False  # Don't suppress exceptions

    async def __aenter__(self) -> "LangWatchSpan":
        """Makes the span usable as an async context manager."""
        self.trace = self.trace or stored_langwatch_trace.get(None)
        if not self.ignore_missing_trace_warning and not self.trace:
            warn("No current trace found, some spans may not be sent to LangWatch")

        self._create_span()
        self.span = cast(
            Type["LangWatchSpan"],
            lambda **kwargs: LangWatchSpan(
                trace=self.trace or stored_langwatch_trace.get(None), **kwargs
            ),
        )

        return self

    async def __aexit__(
        self,
        exc_type: Optional[type],
        exc_value: Optional[BaseException],
        traceback: Any,
    ) -> bool:
        """Exit the async span context, recording any errors that occurred."""
        try:
            # Fix: Check if exc_value is an Exception before recording
            if exc_value is not None and isinstance(exc_value, Exception):
                self.record_error(exc_value)
        finally:
            self._cleanup(exc_type, exc_value, traceback)
        return False  # Don't suppress exceptions

    def __del__(self):
        """Ensure span context is cleaned up if object is garbage collected."""
        self._cleanup(None, None, None)

    def _set_callee_input_information(
        self, func: Callable[..., Any], *args: Any, **kwargs: Any
    ):
        """Set the name and input of the span based on the callee function and arguments."""

        sig = inspect.signature(func)
        parameters = list(sig.parameters.values())

        all_args = {
            str(parameter.name): value for parameter, value in zip(parameters, args)
        }

        # Skip self parameters because it doesn't really help with debugging, becomes just noise
        if "self" in all_args and len(all_args) > 0 and parameters[0].name == "self":
            self_ = all_args["self"]
            if self.name is None:
                try:
                    self.update_name(f"{self_.__class__.__name__}.{func.__name__}")
                except:
                    pass
            del all_args["self"]

        # Fallback to only the function name if no name is set
        if self.name is None:
            self.update_name(func.__name__)

        if self.capture_input is False or self.input is not None:
            return

        if kwargs and len(kwargs) > 0:
            if kwargs:
                all_args.update(kwargs)

        if len(all_args) == 0:
            return

        self.update(input=convert_typed_values(all_args))

    def _set_callee_output_information(self, func: Callable[..., Any], output: Any):
        if self.name is None:
            self.update_name(func.__name__)
        if self.capture_output is False or self.output is not None:
            return

        self.update(output=convert_typed_values(output))

    @staticmethod
    def wrap_otel_span(
        otel_span: "trace_api.Span", trace: Optional["LangWatchTrace"] = None
    ) -> "LangWatchSpan":
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
        span._lock = threading.Lock()
        span._cleaned_up = False
        # TODO(afr): Check if this is correct
        span.capture_input = True
        span.capture_output = True

        return span


def span(
    trace: Optional["LangWatchTrace"] = None,
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
    links: Optional[List[Link]] = None,
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
        type=type or "span",
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
