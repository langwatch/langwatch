import sys

from .utils.module import module_property
from .observability.tracing import trace
from .observability.samping import sampling_rate
from .observability.context import get_current_trace, get_current_span
from .observability.span import span
from .state import get_api_key, get_endpoint
from .__version__ import __version__
from .utils.initialization import ensure_setup, setup


@module_property
def _endpoint():
    return get_endpoint()
@module_property
def _api_key():
    return get_api_key()

__all__ = [
    "setup",
    "trace",
    "span",
    "endpoint",
    "api_key",
    "login",
    "__version__",
    "sampling_rate",
    "ensure_setup",
    "get_current_trace",
    "get_current_span",
]
