"""
Tracing decorator for LangWatch prompt operations.

This module provides OpenTelemetry tracing capabilities for prompt service operations,
supporting both synchronous and asynchronous functions with automatic span management
and attribute extraction.
"""

from typing import Any, Callable, Dict, Awaitable, Union
import asyncio
from functools import wraps
from opentelemetry import trace
from langwatch.attributes import AttributeKey

# Type alias for functions that may or may not be async
MaybeAsync = Union[Callable[..., Any], Callable[..., Awaitable[Any]]]


def trace_prompt(op: str, inputs: Callable[..., Dict[str, Any]]):
    """
    Decorator for tracing prompt service operations with OpenTelemetry.

    Creates spans for prompt operations and automatically extracts relevant attributes
    from function inputs and results. Supports both sync and async functions.

    Args:
        op: Operation name to include in the span name (e.g., "get", "create", "update")
        inputs: Function that extracts input attributes from the decorated function's arguments.
               Should return a dictionary of attributes to set on the span.

    Returns:
        Decorator function that wraps the target function with tracing capabilities

    Example:
        @trace_prompt("get", lambda _self, prompt_id, **_: {"inputs.prompt_id": prompt_id})
        def get_prompt(self, prompt_id: str) -> Prompt:
            # Implementation here
            pass

    Note:
        - Span names follow the pattern "prompt.service.{op}"
        - Automatically records exceptions and re-raises them
        - Extracts prompt attributes from results using _set_prompt_attrs
    """
    tracer = trace.get_tracer(__name__)

    def decorator(fn: MaybeAsync) -> MaybeAsync:
        if asyncio.iscoroutinefunction(fn):

            @wraps(fn)
            async def wrapped(self, *args: Any, **kwargs: Any):
                with tracer.start_as_current_span(f"prompt.service.{op}") as span:
                    try:
                        # Extract and set input attributes
                        attrs = inputs(self, *args, **kwargs)
                        if attrs:
                            span.set_attributes(attrs)

                        # Execute the wrapped function
                        result = await fn(self, *args, **kwargs)

                        # Extract and set output attributes from result
                        _set_prompt_attrs(span, result)
                        return result
                    except Exception as ex:
                        # Record exception for observability
                        span.record_exception(ex)
                        raise

            return wrapped  # type: ignore[return-value]

        @wraps(fn)
        def wrapped(self, *args: Any, **kwargs: Any):
            with tracer.start_as_current_span(f"prompt.service.{op}") as span:
                try:
                    # Extract and set input attributes
                    attrs = inputs(self, *args, **kwargs)
                    if attrs:
                        span.set_attributes(attrs)

                    # Execute the wrapped function
                    result = fn(self, *args, **kwargs)

                    # Extract and set output attributes from result
                    _set_prompt_attrs(span, result)
                    return result
                except Exception as ex:
                    # Record exception for observability
                    span.record_exception(ex)
                    raise

        return wrapped  # type: ignore[return-value]

    return decorator


def _set_prompt_attrs(span, result: Any):
    """
    Extract and set prompt-related attributes from operation results.

    Attempts to extract prompt ID, version ID, and version number from the result
    object and set them as span attributes for tracing purposes.

    Args:
        span: OpenTelemetry span to set attributes on
        result: Result object from prompt operation (typically a Prompt instance)

    Note:
        Uses defensive programming - catches all exceptions to avoid interfering
        with the main operation flow. Missing attributes are silently ignored.

        Expected attributes on result object:
        - id: Prompt ID
        - version_id: Version ID
        - version_number: Version number
    """
    try:
        # Extract prompt attributes from result object
        pid = getattr(result, "id", None)
        vid = getattr(result, "version_id", None)
        vno = getattr(result, "version_number", None)

        # Build attributes dictionary
        out: Dict[str, Any] = {}
        if pid is not None:
            out[AttributeKey.LangWatchPromptId] = pid
        if vid is not None:
            out[AttributeKey.LangWatchPromptVersionId] = vid
        if vno is not None:
            out[AttributeKey.LangWatchPromptVersionNumber] = vno

        # Set attributes on span if any were found
        if out:
            span.set_attributes(out)
    except Exception:
        # Silently ignore attribute extraction failures to avoid disrupting main flow
        pass
