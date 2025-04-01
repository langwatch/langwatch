from typing import Dict

from .observability.tracing import trace, sampling_rate, get_current_trace
from .observability.span import span
from .state import get_endpoint
from .types import BaseAttributes
from .__version__ import __version__
from .utils.initialization import ensure_setup, setup

# Export the endpoint getter function
endpoint = get_endpoint

__all__ = [
    "setup",
    "trace",
    "span",
    "endpoint",
    "login",
    "__version__",
    "sampling_rate",
    "ensure_setup",
    "get_current_trace",
]
