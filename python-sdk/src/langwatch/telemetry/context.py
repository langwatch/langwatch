from typing import TYPE_CHECKING
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
stored_langwatch_span = contextvars.ContextVar["LangWatchSpan"]("stored_langwatch_span")


def get_current_trace(suppress_warning: bool = False) -> "LangWatchTrace":
    """Get the current trace from the LangWatch context.

    Returns:
        A LangWatchTrace.
    """
    ensure_setup()
    trace = stored_langwatch_trace.get(None)
    if trace is not None:
        return trace

    from langwatch.telemetry.tracing import LangWatchTrace

    if not suppress_warning:
        warnings.warn(
            "No trace in context when calling langwatch.get_current_trace(), perhaps you forgot to use @langwatch.trace()?",
        )

    return LangWatchTrace().__enter__()


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

    # Fall back to OpenTelemetry context
    otel_span = trace_api.get_current_span()
    trace = get_current_trace()

    from langwatch.telemetry.span import LangWatchSpan

    return LangWatchSpan.wrap_otel_span(otel_span, trace)
