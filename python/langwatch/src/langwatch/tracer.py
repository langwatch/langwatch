import warnings
from functools import wraps
from langwatch.telemetry.tracing import LangWatchTrace, LangWatchSpan
from langwatch.telemetry.context import get_current_span as gcs, get_current_trace as gct
def _deprecated(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        warnings.warn(f"{func.__name__} is deprecated. Use langwatch.telemetry.tracing instead.",
                     DeprecationWarning, stacklevel=2)
        return func(*args, **kwargs)
    return wrapper

@_deprecated
def get_current_span():
    return gcs()

@_deprecated
def get_current_trace():
    return gct()

warnings.warn(
    "ContextSpan is deprecated. Use LangWatchSpan from langwatch.telemetry.tracing instead.",
    DeprecationWarning,
    stacklevel=2,
)
ContextSpan = LangWatchSpan

warnings.warn(
    "ContextTrace is deprecated. Use LangWatchTrace from langwatch.telemetry.tracing instead.",
    DeprecationWarning,
    stacklevel=2,
)
ContextTrace = LangWatchTrace
