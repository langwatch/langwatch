import threading
from typing import TYPE_CHECKING, List
import contextvars
import warnings
from opentelemetry import trace as trace_api

from langwatch.utils.initialization import ensure_setup

if TYPE_CHECKING:
    from langwatch.telemetry.span import LangWatchSpan
    from langwatch.telemetry.tracing import LangWatchTrace

stored_langwatch_trace = contextvars.ContextVar["LangWatchTrace"](
    "stored_langwatch_trace"
)
main_thread_langwatch_trace: List["LangWatchTrace"] = []

stored_langwatch_span = contextvars.ContextVar["LangWatchSpan"]("stored_langwatch_span")
main_thread_langwatch_span: List["LangWatchSpan"] = []


def get_current_trace(
    suppress_warning: bool = False, start_if_none: bool = False
) -> "LangWatchTrace":
    """Get the current trace from the LangWatch context.

    Returns:
        A LangWatchTrace.
    """
    ensure_setup()
    trace = stored_langwatch_trace.get(None)
    if trace is not None:
        return trace

    if _is_on_child_thread() and len(main_thread_langwatch_trace) > 0:
        return main_thread_langwatch_trace[-1]

    from langwatch.telemetry.tracing import LangWatchTrace

    if not suppress_warning:
        warnings.warn(
            "No trace in context when calling langwatch.get_current_trace(), perhaps you forgot to use @langwatch.trace()?",
        )

    trace = LangWatchTrace()
    if start_if_none:
        return trace.__enter__()
    return trace


def get_current_span() -> "LangWatchSpan":
    """Get the current span from the LangWatch context.
    If no span exists in LangWatch context, falls back to OpenTelemetry context.

    Returns:
        A LangWatchSpan.
    """
    ensure_setup()

    # First try getting from LangWatch context
    span = stored_langwatch_span.get(None)
    if span is not None:
        return span

    if _is_on_child_thread() and len(main_thread_langwatch_span) > 0:
        return main_thread_langwatch_span[-1]

    # Fall back to OpenTelemetry context
    otel_span = trace_api.get_current_span()
    trace = get_current_trace()

    from langwatch.telemetry.span import LangWatchSpan

    return LangWatchSpan.wrap_otel_span(otel_span, trace)


def _set_current_trace(trace: "LangWatchTrace"):
    global main_thread_langwatch_trace
    if not _is_on_child_thread():
        main_thread_langwatch_trace.append(trace)

    try:
        return stored_langwatch_trace.set(trace)
    except Exception as e:
        warnings.warn(f"Failed to set LangWatch trace context: {e}")
        return None


def _set_current_span(span: "LangWatchSpan"):
    global main_thread_langwatch_span
    if not _is_on_child_thread():
        main_thread_langwatch_span.append(span)

    try:
        return stored_langwatch_span.set(span)
    except Exception as e:
        warnings.warn(f"Failed to set LangWatch span context: {e}")
        return None


def _reset_current_trace(token: contextvars.Token):
    global main_thread_langwatch_trace
    if not _is_on_child_thread():
        if len(main_thread_langwatch_trace) > 0:
            main_thread_langwatch_trace.pop()

    try:
        stored_langwatch_trace.reset(token)
    except Exception as e:
        # Only warn if it's not a context error
        if "different Context" not in str(e):
            warnings.warn(f"Failed to reset LangWatch trace context: {e}")


def _reset_current_span(token: contextvars.Token):
    global main_thread_langwatch_span
    if not _is_on_child_thread():
        if len(main_thread_langwatch_span) > 0:
            main_thread_langwatch_span.pop()

    try:
        stored_langwatch_span.reset(token)
    except Exception as e:
        # Only warn if it's not a context error
        if "different Context" not in str(e):
            warnings.warn(f"Failed to reset LangWatch span context: {e}")


def _is_on_child_thread() -> bool:
    return threading.current_thread() != threading.main_thread()
