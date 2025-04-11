from typing import TYPE_CHECKING
import contextvars
from opentelemetry import trace as trace_api

from langwatch.utils.initialization import ensure_setup

if TYPE_CHECKING:
    from langwatch.observability.span import LangWatchSpan
    from langwatch.observability.tracing import LangWatchTrace

# Context variable for the current trace
stored_langwatch_trace = contextvars.ContextVar('stored_langwatch_trace')

# Context variable for the current span
stored_langwatch_span = contextvars.ContextVar('stored_langwatch_span') 

def get_current_trace() -> 'LangWatchTrace':
    """Get the current trace from the LangWatch context.
    
    Returns:
        The current LangWatchTrace if one exists in the context, otherwise None.
    """
    ensure_setup()
    trace = stored_langwatch_trace.get(None)
    if trace is not None:
        return trace

    from langwatch.observability.tracing import LangWatchTrace
    return LangWatchTrace()

def get_current_span() -> 'LangWatchSpan':
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
    trace = get_current_trace()
    return LangWatchSpan.wrap_otel_span(otel_span, trace)
