import threading
from typing import TYPE_CHECKING, Dict, List
import contextvars
import warnings
from opentelemetry import trace as trace_api
from opentelemetry import context

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
        otel_span = trace_api.get_current_span()
        otel_span_id = otel_span.get_span_context().span_id
        trace.__enter__()

        # Keep the previous span in the context if we are starting a new trace not at root level
        if otel_span_id != 0:
            ctx = trace_api.set_span_in_context(otel_span)
            context.attach(ctx)
        otel_span = trace_api.get_current_span()

        trace.__exit__(None, None, None)

        return trace
    return trace


def get_current_span() -> "LangWatchSpan":
    """Get the current span from the LangWatch context.
    If no span exists in LangWatch context, falls back to OpenTelemetry context.

    Returns:
        A LangWatchSpan.
    """
    ensure_setup()

    otel_span = trace_api.get_current_span()
    otel_span_id = otel_span.get_span_context().span_id

    # If on a child thread and there is no parent, try to find a parent from the main thread
    if (
        _is_on_child_thread()
        and len(main_thread_langwatch_span) > 0
        and otel_span_id == 0
    ):
        return main_thread_langwatch_span[-1]

    from langwatch.telemetry.span import LangWatchSpan

    trace = get_current_trace()
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

    # Dummy token, just for the main thread span list
    return "token"


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


def _reset_current_span(_token: str):
    global main_thread_langwatch_span
    if not _is_on_child_thread():
        if len(main_thread_langwatch_span) > 0:
            main_thread_langwatch_span.pop()


def _is_on_child_thread() -> bool:
    return threading.current_thread() != threading.main_thread()
