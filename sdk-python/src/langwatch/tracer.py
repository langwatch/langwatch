from typing import Any, Callable
import warnings
from functools import wraps
from langwatch.telemetry.tracing import LangWatchTrace, LangWatchSpan
from langwatch.telemetry.context import get_current_span as gcs, get_current_trace as gct

def _deprecated(func: Callable[[], Any]) -> Callable[[], Any]:
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        warnings.warn(
            f"{func.__name__} is deprecated. Use langwatch.telemetry instead.",
            DeprecationWarning, stacklevel=2,
        )
        return func(*args, **kwargs)
    return wrapper

@_deprecated
def get_current_span():
    return gcs()

@_deprecated
def get_current_trace():
    return gct()

warnings.warn(
    "ContextSpan and ContextTrace are deprecated. Use LangWatchSpan from langwatch.telemetry.span and LangWatchTrace from langwatch.telemetry.tracing instead.",
    DeprecationWarning,
    stacklevel=2,
)

ContextSpan = LangWatchSpan
ContextTrace = LangWatchTrace
